import { describe, it, expect } from "vitest";
import { apiStepToConfig, configToApiStep } from "./WorkflowEditor";
import { TYPE_COLORS } from "./workflow-canvas/constants";
import { TYPE_ICONS } from "./workflow-canvas/utils/typeIcons";
import type { EditableNodeConfig } from "@/lib/types";

/** The slack step's config surface.
 *
 * Two things matter beyond the round trip. First, the step must never carry a
 * credential: the provider reads SLACK_BOT_TOKEN from the deployment, so a
 * token in a saved workflow definition would be a leak that outlives the run.
 * Second, only the fields the chosen action uses get sent, so switching a node
 * from `post` to `history` does not leave a stale message body behind for the
 * backend to template.
 */
describe("slack step serialisation", () => {
  const cfg = (extra: Partial<EditableNodeConfig>): EditableNodeConfig =>
    ({ id: "notify", type: "slack", name: "notify", ...extra } as EditableNodeConfig);

  it("always sends an action, defaulting to post", () => {
    expect(configToApiStep(cfg({}))).toMatchObject({ type: "slack", action: "post" });
  });

  it("sends channel, text and output_key for a post", () => {
    expect(configToApiStep(cfg({
      action: "post", channel: "C0BLDDSEB1D", text: "{digest}", output_key: "posted",
    }))).toMatchObject({
      action: "post", channel: "C0BLDDSEB1D", text: "{digest}", output_key: "posted",
    });
  });

  it("sends the history window only for history", () => {
    const history = configToApiStep(cfg({
      action: "history", channel: "C1", oldest: "{window}", limit: 200,
    }));
    expect(history).toMatchObject({ oldest: "{window}", limit: 200 });

    const post = configToApiStep(cfg({
      action: "post", channel: "C1", text: "x", oldest: "{window}", limit: 200,
    }));
    expect(post).not.toHaveProperty("oldest");
    expect(post).not.toHaveProperty("limit");
  });

  it("sends the batch/idempotency fields only for reply", () => {
    const reply = configToApiStep(cfg({
      action: "reply", channel: "C1", thread_id: "{ts}",
      items: "overrides.confirmations", skip_if_replied: true,
    }));
    expect(reply).toMatchObject({
      thread_id: "{ts}", items: "overrides.confirmations", skip_if_replied: true,
    });

    const post = configToApiStep(cfg({
      action: "post", channel: "C1", text: "x",
      items: "overrides.confirmations", skip_if_replied: true,
    }));
    expect(post).not.toHaveProperty("items");
    expect(post).not.toHaveProperty("skip_if_replied");
  });

  it("sends user_id and no channel for a dm", () => {
    const dm = configToApiStep(cfg({
      action: "dm", user_id: "{owner}", text: "no usable export", channel: "C1",
    }));
    expect(dm).toMatchObject({ action: "dm", user_id: "{owner}" });
    expect(dm).not.toHaveProperty("channel");
  });

  it("sends message_id only for delete", () => {
    expect(configToApiStep(cfg({
      action: "delete", channel: "C1", message_id: "{ts}",
    }))).toMatchObject({ action: "delete", message_id: "{ts}" });
    expect(configToApiStep(cfg({ action: "post", channel: "C1", message_id: "{ts}" })))
      .not.toHaveProperty("message_id");
  });

  it("omits the provider while it is the default", () => {
    expect(configToApiStep(cfg({ action: "post", provider: "slack" })))
      .not.toHaveProperty("provider");
    expect(configToApiStep(cfg({ action: "post", provider: "whatsapp" })))
      .toMatchObject({ provider: "whatsapp" });
  });

  it("never serialises a credential", () => {
    const step = configToApiStep(cfg({
      action: "post", channel: "C1", text: "x",
      // Fields a well-meaning user might try to smuggle a token through.
      slack_token: "xoxb-should-not-travel",
    }));
    for (const forbidden of ["token", "slack_token", "bot_token", "api_key", "headers"]) {
      expect(step).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(step)).not.toContain("xoxb");
  });

  it("round-trips through apiStepToConfig", () => {
    const step = configToApiStep(cfg({
      action: "reply", channel: "C1", items: "overrides.confirmations",
      skip_if_replied: true, ignore_errors: true, output_key: "confirmed",
    }));
    const back = apiStepToConfig(step);
    expect(back).toMatchObject({
      type: "slack", action: "reply", channel: "C1",
      items: "overrides.confirmations", skip_if_replied: true,
      ignore_errors: true, output_key: "confirmed",
    });
  });

  it("has a canvas colour and an icon, like every other step type", () => {
    expect(TYPE_COLORS.slack).toBeDefined();
    expect(TYPE_ICONS.slack).toBeDefined();
  });
});
