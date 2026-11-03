// The Agents panel's models. They are reached only through the Rodeo server (its key, the user's
// sign-in and AI credit), and the server picks them: the planner, and the model its subagents run on.

export interface AgentSettings {
  /** the model that plans, works and talks to the user */
  readonly planner: string;
  /** the model its subagents run on */
  readonly worker: string;
}

export const DEFAULT_PLANNER = "anthropic/claude-opus-5.5";
export const DEFAULT_WORKER = "anthropic/claude-haiku-5.5";

// what earlier versions kept in this browser (picked models, a step limit, once an API key of the
// user's own) is dropped: none of it is the user's to set now
try {
  localStorage.removeItem("openvwx.agents.settings.v1");
} catch {
  // storage blocked: nothing was kept
}

/** The server's models (`offered`), or the defaults until its config is in. */
export function agentSettings(offered?: { planner: string; worker: string } | null): AgentSettings {
  return { planner: offered?.planner || DEFAULT_PLANNER, worker: offered?.worker || DEFAULT_WORKER };
}

/** "claude-opus-5.5" for "anthropic/claude-opus-5.5": the model's own name, for labels. */
export function shortModel(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}
