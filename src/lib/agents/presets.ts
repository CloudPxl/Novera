/**
 * Starting points for connecting an agent that speaks a known platform's API.
 *
 * A preset is a form filler and nothing more: it writes the same stored fields a person could
 * type (address, request body, reply path, header name), so a run still goes through the one
 * HTTP adapter with the one public-address guard, and there is no per-platform code path to
 * drift. What a preset fills in is a starting point; "Verify the connection" shows what the
 * endpoint actually answered, and that — never the preset — is what proves it.
 *
 * Pure and browser-safe: the connect form applies a preset before anything is sent anywhere.
 */
export interface ConnectionPreset {
  key: string;
  label: string;
  /** One line under the picker: what this is for and what it changes. */
  about: string;
  /** Shown as the address field's placeholder. */
  urlExample: string;
  bodyTemplate: Record<string, unknown>;
  responsePath: string;
  toolActivityPath?: string;
  streamPath?: string;
  conversationIdPath?: string;
  authHeaderName?: string;
  /** Fixed, non-secret headers the platform requires. */
  headers?: Record<string, string>;
  /** Something the person must change before it can work (a model name, a flow id). */
  edit?: string;
  /** How conversations are carried, in a sentence, for the form. */
  conversation: string;
  /** Each streamed event carries the whole reply so far. */
  streamMode?: "whole";
  /** The platform allows one request at a time. */
  sendOneAtATime?: boolean;
}

export const CUSTOM_PRESET = "custom";

export const PRESETS: readonly ConnectionPreset[] = [
  {
    key: CUSTOM_PRESET,
    label: "Custom JSON endpoint",
    about: "Your own endpoint or webhook. Sends one JSON field with the message and reads one field of the reply.",
    urlExample: "https://api.example.com/support/chat",
    bodyTemplate: { message: "{{input}}" },
    responsePath: "reply",
    conversation: "Add {{history}}, {{messages}} or {{conversation_id}} to the request body if your endpoint can carry a conversation.",
  },
  {
    key: "dify",
    label: "Dify (chat, agent or chatflow app)",
    about: "Dify's chat-messages API. Asks for a streamed answer, which every Dify app type supports, and puts the pieces back together.",
    urlExample: "https://api.dify.ai/v1/chat-messages",
    bodyTemplate: { inputs: {}, query: "{{input}}", response_mode: "streaming", user: "novera-evaluation", conversation_id: "{{conversation_id}}" },
    responsePath: "answer",
    streamPath: "answer",
    conversationIdPath: "conversation_id",
    authHeaderName: "authorization",
    conversation: "Dify issues its own conversation id: the first message of a conversation carries none, later ones carry the id Dify returned.",
  },
  {
    key: "dify-workflow",
    label: "Dify workflow app (non-chat)",
    about: "Dify's workflows/run API, for a workflow that takes inputs and returns outputs rather than chatting. The message goes in the query input; the reply is the workflow's text output.",
    urlExample: "https://api.dify.ai/v1/workflows/run",
    bodyTemplate: { inputs: { query: "{{input}}" }, response_mode: "blocking", user: "novera-evaluation" },
    responsePath: "data.outputs.text",
    streamPath: "data.text",
    authHeaderName: "authorization",
    edit: "Rename query and text to your workflow's own input and output variable names (Start node and End node), and add its other input variables.",
    conversation: "A workflow has no conversation: conversation scenarios are not sent unless the delivery option puts the earlier turns in the message.",
  },
  {
    key: "openai",
    label: "OpenAI-compatible chat completions",
    about: "Any endpoint that takes a list of chat messages at /chat/completions: a gateway, a proxy or your own agent behind that API.",
    urlExample: "https://api.example.com/v1/chat/completions",
    bodyTemplate: { model: "your-model", messages: "{{messages}}" },
    responsePath: "choices.0.message.content",
    toolActivityPath: "choices.0.message.tool_calls",
    authHeaderName: "authorization",
    edit: "Replace your-model in the request body with the model or agent name your endpoint expects.",
    conversation: "The earlier turns travel in the messages list, as chat endpoints expect.",
  },
  {
    key: "openai-responses",
    label: "OpenAI Responses API",
    about: "An endpoint that takes input at /v1/responses and answers with output items.",
    urlExample: "https://api.example.com/v1/responses",
    bodyTemplate: { model: "your-model", input: "{{messages}}" },
    responsePath: "output.*.content.*.text",
    authHeaderName: "authorization",
    edit: "Replace your-model in the request body with the model or agent name your endpoint expects.",
    conversation: "The earlier turns travel in the input list.",
  },
  {
    key: "anthropic",
    label: "Anthropic-compatible messages",
    about: "An endpoint that takes a list of chat messages at /v1/messages and answers with content blocks.",
    urlExample: "https://api.example.com/v1/messages",
    bodyTemplate: { model: "your-model", max_tokens: 1024, messages: "{{messages}}" },
    responsePath: "content.0.text",
    authHeaderName: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
    edit: "Replace your-model in the request body with the model name your endpoint expects.",
    conversation: "The earlier turns travel in the messages list.",
  },
  {
    key: "flowise",
    label: "Flowise prediction",
    about: "A Flowise chatflow's prediction endpoint.",
    urlExample: "https://flowise.example.com/api/v1/prediction/your-chatflow-id",
    bodyTemplate: { question: "{{input}}", overrideConfig: { sessionId: "{{conversation_id}}" } },
    responsePath: "text",
    authHeaderName: "authorization",
    conversation: "Each scenario gets its own session id, so a chatflow with memory never mixes two scenarios.",
  },
  {
    key: "n8n",
    label: "n8n chat trigger",
    about: "An n8n workflow started by a Chat Trigger and answered by its last node.",
    urlExample: "https://n8n.example.com/webhook/your-webhook-id/chat",
    bodyTemplate: { action: "sendMessage", chatInput: "{{input}}", sessionId: "{{conversation_id}}" },
    responsePath: "output",
    conversation: "Each scenario gets its own session id.",
  },
  {
    key: "langgraph",
    label: "LangGraph run (wait for the result)",
    about: "A LangGraph deployment's stateless runs/wait endpoint. The reply is the last message of the graph's output.",
    urlExample: "https://langgraph.example.com/runs/wait",
    bodyTemplate: { assistant_id: "agent", input: { messages: "{{messages}}" } },
    responsePath: "messages.-1.content",
    authHeaderName: "x-api-key",
    edit: "Replace agent with your graph's assistant id, and check that your graph's state keeps its messages under messages.",
    conversation: "The earlier turns travel in the messages list.",
  },
  {
    key: "voiceflow",
    label: "Voiceflow dialog API",
    about: "Voiceflow's interact endpoint. The reply is every text message of the answer, one per line.",
    urlExample: "https://general-runtime.voiceflow.com/state/user/{{conversation_id}}/interact",
    bodyTemplate: { action: { type: "text", payload: "{{input}}" } },
    responsePath: "*.payload.message",
    authHeaderName: "authorization",
    conversation: "Voiceflow keeps a conversation per user id in the address, so {{conversation_id}} sits there: each scenario is its own user.",
  },
  {
    key: "langflow",
    label: "Langflow run",
    about: "A Langflow flow's run endpoint, with a chat input and a chat output.",
    urlExample: "https://langflow.example.com/api/v1/run/your-flow-id",
    bodyTemplate: { input_value: "{{input}}", input_type: "chat", output_type: "chat", session_id: "{{conversation_id}}" },
    responsePath: "outputs.0.outputs.0.results.message.text",
    authHeaderName: "x-api-key",
    conversation: "Each scenario gets its own session id.",
  },
];

export function presetByKey(key: string | null | undefined): ConnectionPreset | null {
  return PRESETS.find((p) => p.key === key) ?? null;
}

/**
 * Which platform an address looks like, or null. Read from the host and path only; a wrong guess
 * costs nothing, because the form only offers it and the connection check decides.
 */
export function detectPreset(rawUrl: string): ConnectionPreset | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim().split("{{conversation_id}}").join("conversation"));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const is = (key: string) => presetByKey(key);
  if (/\/workflows\/run$/.test(path)) return is("dify-workflow");
  if (host === "api.dify.ai" || host.endsWith(".dify.ai") || /\/chat-messages$/.test(path)) return is("dify");
  if (/\/v1\/responses$/.test(path)) return is("openai-responses");
  if (/\/runs\/wait$/.test(path)) return is("langgraph");
  if (host.endsWith("voiceflow.com")) return is("voiceflow");
  if (/\/chat\/completions$/.test(path)) return is("openai");
  if (host === "api.anthropic.com" || /\/v1\/messages$/.test(path)) return is("anthropic");
  if (/\/api\/v1\/prediction\/[^/]+$/.test(path)) return is("flowise");
  if (/\/api\/v1\/run\/[^/]+$/.test(path)) return is("langflow");
  if (/\/webhook(-test)?\/[^/]+\/chat$/.test(path)) return is("n8n");
  return null;
}

/**
 * The address a preset's endpoint actually lives at, when a person pasted the API's base. Only
 * the two cases where the base is what a platform's own documentation shows first; anything else
 * comes back unchanged, with nothing guessed.
 */
export function normalisePresetUrl(presetKey: string, rawUrl: string): { url: string; note: string | null } {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { url: trimmed, note: null };
  }
  const path = url.pathname.replace(/\/+$/, "");
  const withPath = (next: string) => {
    url.pathname = next;
    return url.toString();
  };
  if (presetKey === "dify" && (path === "" || path === "/v1")) {
    return { url: withPath("/v1/chat-messages"), note: "The address was Dify's API base, so /v1/chat-messages was added: that is where a chat message is sent." };
  }
  if (presetKey === "openai" && /(^|\/)v1$/.test(path)) {
    return { url: withPath(`${path}/chat/completions`), note: "The address was the API base, so /chat/completions was added." };
  }
  return { url: trimmed, note: null };
}

/** What a preset writes into the connect form, as the form's own field values. */
export function presetFormValues(preset: ConnectionPreset): {
  bodyTemplate: string; responsePath: string; toolActivityPath: string; streamPath: string;
  conversationIdPath: string; authHeaderName: string; headers: string; preset: string;
  streamMode: string; sendOneAtATime: string;
} {
  return {
    bodyTemplate: JSON.stringify(preset.bodyTemplate, null, 2),
    responsePath: preset.responsePath,
    toolActivityPath: preset.toolActivityPath ?? "",
    streamPath: preset.streamPath ?? "",
    conversationIdPath: preset.conversationIdPath ?? "",
    authHeaderName: preset.authHeaderName ?? "",
    headers: Object.entries(preset.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
    preset: preset.key,
    streamMode: preset.streamMode ?? "pieces",
    sendOneAtATime: preset.sendOneAtATime ? "on" : "",
  };
}
