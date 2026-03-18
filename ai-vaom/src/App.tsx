import {
  type FormEvent,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";

type OrderStage =
  | "confirmed"
  | "preparing"
  | "out for delivery"
  | "delivered"
  | "cancelled";

type OrderRecord = {
  id: string;
  item: string;
  quantity: number;
  createdAt: number;
  updatedAt: number;
  state: "active" | "cancelled";
  customizations: string[];
};

type ConversationEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type SpeechRecognitionAlternativeLike = ArrayLike<{ transcript: string }>;
type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionAlternativeLike>;
};
type SpeechRecognitionErrorLike = {
  error: string;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((event: SpeechRecognitionErrorLike) => void);
  onresult: null | ((event: SpeechRecognitionEventLike) => void);
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const samplePrompts = [
  "Order two pizzas",
  "Cancel my last order",
  "Where is my order?",
  "Modify my order add one coke",
];

const numberMap: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const stageMeta: Record<
  OrderStage,
  { badge: string; description: string; progress: number }
> = {
  confirmed: {
    badge: "Confirmed",
    description: "Your request has been accepted and queued.",
    progress: 22,
  },
  preparing: {
    badge: "Preparing",
    description: "The kitchen or packing team is working on it now.",
    progress: 55,
  },
  "out for delivery": {
    badge: "On the way",
    description: "Your order is packed and heading to you.",
    progress: 82,
  },
  delivered: {
    badge: "Delivered",
    description: "The order journey is complete.",
    progress: 100,
  },
  cancelled: {
    badge: "Cancelled",
    description: "The order was stopped before completion.",
    progress: 0,
  },
};

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanItemName(item: string) {
  return item
    .replace(/\b(?:please|for me|right now|thanks|thank you)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentenceCase(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseQuantity(token: string | undefined) {
  if (!token) {
    return null;
  }

  const numeric = Number(token);

  if (!Number.isNaN(numeric) && numeric > 0) {
    return numeric;
  }

  return numberMap[token] ?? null;
}

function formatOrderPhrase(order: Pick<OrderRecord, "item" | "quantity">) {
  if (order.quantity <= 1) {
    return order.item;
  }

  return `${order.quantity} ${order.item}`;
}

function getOrderStage(order: OrderRecord, now: number): OrderStage {
  if (order.state === "cancelled") {
    return "cancelled";
  }

  const elapsed = now - order.createdAt;

  if (elapsed < 18_000) {
    return "confirmed";
  }

  if (elapsed < 45_000) {
    return "preparing";
  }

  if (elapsed < 75_000) {
    return "out for delivery";
  }

  return "delivered";
}

function getLatestOrder(orders: OrderRecord[]) {
  return orders[orders.length - 1];
}

function getLatestEditableOrder(orders: OrderRecord[], now: number) {
  return [...orders]
    .reverse()
    .find(
      (order) =>
        order.state === "active" && getOrderStage(order, now) !== "delivered",
    );
}

function extractCreateDetails(command: string) {
  const match = command.match(
    /(?:order|create(?: an)? order(?: for)?|get me|buy|i want|i need)\s+(.+)/,
  );

  const rawDetails = cleanItemName(match?.[1] ?? command).replace(/^of\s+/, "");

  if (!rawDetails) {
    return null;
  }

  const tokens = rawDetails.split(" ");
  const quantity = parseQuantity(tokens[0]);

  if (quantity) {
    const item = cleanItemName(tokens.slice(1).join(" "));
    return item ? { quantity, item } : null;
  }

  return { quantity: 1, item: rawDetails };
}

function extractModification(command: string) {
  const changeMatch = command.match(/change\s+(.+)\s+to\s+(.+)/);
  if (changeMatch) {
    return `Change ${changeMatch[1]} to ${changeMatch[2]}`;
  }

  const addMatch = command.match(/add\s+(.+)/);
  if (addMatch) {
    return `Add ${addMatch[1]}`;
  }

  const removeMatch = command.match(/remove\s+(.+)/);
  if (removeMatch) {
    return `Remove ${removeMatch[1]}`;
  }

  const genericMatch = command.match(
    /(?:modify|update)(?:\s+my)?(?:\s+last)?(?:\s+order)?\s+(.+)/,
  );

  if (genericMatch) {
    return toSentenceCase(genericMatch[1]);
  }

  return "";
}

function createOrderId(count: number) {
  return `ORD-${String(count + 1).padStart(3, "0")}`;
}

function buildAssistantReply(commandText: string, orders: OrderRecord[], now: number) {
  const command = normalizeText(commandText);

  if (!command) {
    return {
      reply:
        "I did not catch that. Please say something like order two pizzas or where is my order.",
      nextOrders: orders,
      focusOrderId: null as string | null,
    };
  }

  if (/cancel\b/.test(command)) {
    const latestOrder = getLatestEditableOrder(orders, now);

    if (!latestOrder) {
      return {
        reply: "I could not find an active order to cancel.",
        nextOrders: orders,
        focusOrderId: null,
      };
    }

    const nextOrders: OrderRecord[] = orders.map((order) =>
      order.id === latestOrder.id
        ? { ...order, state: "cancelled", updatedAt: now }
        : order,
    );

    return {
      reply: `Order cancelled. Your ${formatOrderPhrase(latestOrder)} request has been stopped.`,
      nextOrders,
      focusOrderId: latestOrder.id,
    };
  }

  if (/(?:modify|change|update|add|remove)\b/.test(command)) {
    const latestOrder = getLatestEditableOrder(orders, now);

    if (!latestOrder) {
      return {
        reply: "There is no active order available to modify right now.",
        nextOrders: orders,
        focusOrderId: null,
      };
    }

    const note = extractModification(command);

    if (!note) {
      return {
        reply: "Tell me what you want to change, for example add one coke.",
        nextOrders: orders,
        focusOrderId: latestOrder.id,
      };
    }

    const nextOrders: OrderRecord[] = orders.map((order) =>
      order.id === latestOrder.id
        ? {
            ...order,
            updatedAt: now,
            customizations: [...order.customizations, note],
          }
        : order,
    );

    return {
      reply: `Order updated. I noted: ${note.toLowerCase()}.`,
      nextOrders,
      focusOrderId: latestOrder.id,
    };
  }

  if (/(?:where is|track|status|where s|order status|my order)/.test(command)) {
    const latestOrder = getLatestOrder(orders);

    if (!latestOrder) {
      return {
        reply: "There is no order to track yet. Try saying order two pizzas.",
        nextOrders: orders,
        focusOrderId: null,
      };
    }

    const stage = getOrderStage(latestOrder, now);

    if (stage === "cancelled") {
      return {
        reply: `Your latest order for ${formatOrderPhrase(latestOrder)} was cancelled.`,
        nextOrders: orders,
        focusOrderId: latestOrder.id,
      };
    }

    if (stage === "delivered") {
      return {
        reply: `Your order for ${formatOrderPhrase(latestOrder)} has already been delivered.`,
        nextOrders: orders,
        focusOrderId: latestOrder.id,
      };
    }

    return {
      reply: `Your order is currently ${stage}.`,
      nextOrders: orders,
      focusOrderId: latestOrder.id,
    };
  }

  const createDetails = extractCreateDetails(command);

  if (!createDetails) {
    return {
      reply:
        "I can create, modify, track, or cancel orders. Try saying order two pizzas.",
      nextOrders: orders,
      focusOrderId: null,
    };
  }

  const nextOrder: OrderRecord = {
    id: createOrderId(orders.length),
    item: createDetails.item,
    quantity: createDetails.quantity,
    createdAt: now,
    updatedAt: now,
    state: "active",
    customizations: [],
  };

  return {
    reply: `Order created successfully. I placed ${formatOrderPhrase(nextOrder)}.`,
    nextOrders: [...orders, nextOrder],
    focusOrderId: nextOrder.id,
  };
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function App() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [conversation, setConversation] = useState<ConversationEntry[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      text: "Voice assistant ready. Say order two pizzas, cancel my last order, or where is my order.",
    },
  ]);
  const [draftCommand, setDraftCommand] = useState("");
  const [assistantReply, setAssistantReply] = useState(
    "Voice assistant ready. I can listen and talk back.",
  );
  const [statusMessage, setStatusMessage] = useState(
    "Press the microphone and speak a command.",
  );
  const [isListening, setIsListening] = useState(false);
  const [supportsRecognition, setSupportsRecognition] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const ordersRef = useRef<OrderRecord[]>([]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    setSupportsRecognition(
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    );
    setSupportsSpeech("speechSynthesis" in window);
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setClock(Date.now());
    }, 5_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakReply = (text: string) => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    const englishVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith("en"));

    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    window.speechSynthesis.speak(utterance);
  };

  const handleCommand = (text: string) => {
    const spokenText = text.trim();

    if (!spokenText) {
      setStatusMessage("Please say or type a valid order command.");
      return;
    }

    setDraftCommand(spokenText);
    const now = Date.now();
    const result = buildAssistantReply(spokenText, ordersRef.current, now);

    ordersRef.current = result.nextOrders;

    startTransition(() => {
      setOrders(result.nextOrders);
      setFocusedOrderId(result.focusOrderId);
      setAssistantReply(result.reply);
      setConversation((current) => [
        ...current,
        { id: `user-${now}`, role: "user", text: spokenText },
        { id: `assistant-${now}`, role: "assistant", text: result.reply },
      ]);
    });

    setStatusMessage(
      supportsSpeech
        ? "Response delivered with voice playback."
        : "Response ready. Voice playback is not supported in this browser.",
    );

    speakReply(result.reply);
  };

  const startListening = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatusMessage(
        "Speech recognition is not available here. Use the text box instead.",
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setStatusMessage("Listening for your order request...");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setStatusMessage(`Microphone issue: ${event.error}.`);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";

      if (!transcript) {
        setStatusMessage("I heard silence. Please try again.");
        return;
      }

      handleCommand(transcript);
    };

    recognition.start();
  };

  const submitTextCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleCommand(draftCommand);
  };

  const orderedCards = [...orders].reverse();

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">AI-Driven Voice Activated Order Management</div>
        <h1>Talk to your order system like an assistant, not a form.</h1>
        <p className="hero-copy">
          This demo listens for spoken order commands, understands simple order
          actions, updates order state instantly, and speaks the answer back to
          the user.
        </p>

        <div className="capability-row">
          <span className={`capability-pill ${supportsRecognition ? "ready" : "limited"}`}>
            {supportsRecognition ? "Mic ready" : "Mic limited"}
          </span>
          <span className={`capability-pill ${supportsSpeech ? "ready" : "limited"}`}>
            {supportsSpeech ? "Voice reply ready" : "Voice reply limited"}
          </span>
        </div>

        <div className="prompt-cloud">
          {samplePrompts.map((prompt) => (
            <button
              key={prompt}
              className="prompt-chip"
              type="button"
              onClick={() => handleCommand(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="story-card">
          <div className="story-metric">
            <strong>{orders.length}</strong>
            <span>Total orders handled</span>
          </div>
          <div className="story-metric">
            <strong>{conversation.length}</strong>
            <span>Conversation events</span>
          </div>
          <div className="story-metric">
            <strong>{isListening ? "Live" : "Standby"}</strong>
            <span>Assistant state</span>
          </div>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="assistant-card">
          <div className="card-header">
            <div>
              <p className="section-label">Voice Console</p>
              <h2>Speak an order command</h2>
            </div>
            <div className={`listening-indicator ${isListening ? "active" : ""}`}>
              {isListening ? "Listening" : "Idle"}
            </div>
          </div>

          <button
            className={`mic-button ${isListening ? "listening" : ""}`}
            type="button"
            onClick={startListening}
          >
            <span className="mic-icon" aria-hidden="true">
              MIC
            </span>
            {isListening ? "Stop listening" : "Tap to speak"}
          </button>

          <p className="status-banner">{statusMessage}</p>

          <form className="command-form" onSubmit={submitTextCommand}>
            <label className="input-label" htmlFor="order-command">
              Recognized or typed command
            </label>
            <div className="input-row">
              <input
                id="order-command"
                className="command-input"
                value={draftCommand}
                onChange={(event) => setDraftCommand(event.target.value)}
                placeholder="Example: Order two pizzas"
              />
              <button className="submit-button" type="submit">
                Process
              </button>
            </div>
          </form>

          <div className="response-panel" aria-live="polite">
            <p className="section-label">Assistant Reply</p>
            <p className="response-text">{assistantReply}</p>
          </div>
        </div>

        <div className="dashboard-grid">
          <section className="dashboard-card">
            <div className="card-header compact">
              <div>
                <p className="section-label">Order Timeline</p>
                <h2>Recent orders</h2>
              </div>
            </div>

            {orderedCards.length === 0 ? (
              <p className="empty-state">
                No orders yet. Try the microphone or tap a sample prompt.
              </p>
            ) : (
              <div className="order-list">
                {orderedCards.map((order) => {
                  const stage = getOrderStage(order, clock);
                  const meta = stageMeta[stage];

                  return (
                    <article
                      key={order.id}
                      className={`order-card ${focusedOrderId === order.id ? "focused" : ""}`}
                    >
                      <div className="order-topline">
                        <div>
                          <p className="order-id">{order.id}</p>
                          <h3>{formatOrderPhrase(order)}</h3>
                        </div>
                        <span className={`stage-badge ${stage.replace(/\s+/g, "-")}`}>
                          {meta.badge}
                        </span>
                      </div>

                      <div className="progress-track" aria-hidden="true">
                        <span style={{ width: `${meta.progress}%` }} />
                      </div>

                      <p className="order-description">{meta.description}</p>

                      <div className="order-meta">
                        <span>Created {formatTime(order.createdAt)}</span>
                        <span>Updated {formatTime(order.updatedAt)}</span>
                      </div>

                      {order.customizations.length > 0 ? (
                        <div className="customization-list">
                          {order.customizations.map((note) => (
                            <span key={`${order.id}-${note}`} className="customization-pill">
                              {note}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="dashboard-card">
            <div className="card-header compact">
              <div>
                <p className="section-label">Conversation Feed</p>
                <h2>Assistant activity</h2>
              </div>
            </div>

            <div className="conversation-list">
              {conversation.map((entry) => (
                <article
                  key={entry.id}
                  className={`message-bubble ${entry.role === "assistant" ? "assistant" : "user"}`}
                >
                  <span className="message-role">
                    {entry.role === "assistant" ? "System" : "User"}
                  </span>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;


