import { readFile, writeFile } from "node:fs/promises";
import { Bot, Button, Row } from "./vendor/yapper.js";

const token = process.env.YAPPER_BOT_TOKEN;
const apiOrigin = String(process.env.CRYSTALOS_API_ORIGIN || "https://crystalos.kiyanxp3.workers.dev").replace(/\/$/, "");
const botSecret = process.env.VERIFICATION_BOT_SECRET;
const stateFile = process.env.YAPIN_STATE_FILE || "./yapin-state.json";
if (!token || !botSecret) throw new Error("YAPPER_BOT_TOKEN and VERIFICATION_BOT_SECRET are required.");

async function loadState() {
  try { return JSON.parse(await readFile(stateFile, "utf8")); } catch { return { cursor: 0, panels: {}, tickets: {} }; }
}
const state = await loadState();
const persist = async () => writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });

async function worker(path, options = {}) {
  const response = await fetch(`${apiOrigin}/api/accounts/verification/bot${path}`, {
    ...options,
    headers: { authorization: `Bearer ${botSecret}`, "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const error = body?.error || { code: "BACKEND_FAILURE", message: `Worker returned ${response.status}.` };
    const failure = new Error(error.message || error.code);
    failure.code = error.code;
    failure.status = response.status;
    throw failure;
  }
  return body;
}

const bot = new Bot(token, { gateway: false, log: true });
const sdkApi = bot.api.bind(bot);
bot.api = async (method, path, body, options) => {
  const resumed = method === "GET" && path === "/events?after=0&wait=0" && Number(state.cursor) > 0
    ? `/events?after=${encodeURIComponent(state.cursor)}&wait=25`
    : path;
  const result = await sdkApi(method, resumed, body, options);
  if (method === "GET" && path.startsWith("/events")) {
    const last = Number(result?.last);
    if (Number.isFinite(last) && last > Number(state.cursor)) {
      state.cursor = last;
      await persist();
    }
  }
  return result;
};
bot.on("error", (error) => console.error("[crystalos-verification]", error?.message || error));

bot.command("verification-setup", "Post the CrystalOS ownership verification panel", async (message) => {
  const panel = await message.reply("Game Ownership Verification", {
    components: [new Row(Button.primary("Open Verification Ticket", "verification:open"))],
  });
  if (panel?.id) {
    state.panels[message.channel_id] = panel.id;
    await persist();
  }
});

bot.onButton("verification:open", async (interaction) => {
  try {
    const channel = await bot.createChannel(interaction.server_id, `verify-${interaction.username}`);
    const staffRoleId = process.env.YAPIN_STAFF_ROLE_ID;
    await bot.editChannel(channel.id, { private: true, roleIds: staffRoleId ? [staffRoleId] : [], readOnly: false });
    const opened = await worker("/open-ticket", {
      method: "POST",
      body: JSON.stringify({
        yapin_user_id: interaction.user_id,
        yapin_username: interaction.username,
        channel_id: channel.id,
        yapin_ticket_id: channel.id,
      }),
    });
    const ticket = opened.ticket || opened.data?.ticket || opened;
    state.tickets[channel.id] = { id: ticket.id, userId: interaction.user_id, channelId: channel.id };
    await persist();
    await interaction.ephemeral("Your private verification ticket is ready. Paste your CrystalOS link code here, then send `game: <catalogue id>` and `evidence: <proof>`.");
    await bot.send(channel.id, "CrystalOS verification ticket opened. Only the backend can approve ownership.");
  } catch (error) {
    await interaction.ephemeral("The verification backend is unavailable. No ownership was granted; please try again later.");
    console.error("[crystalos-verification] open failed", error?.message || error);
  }
});

bot.on("message", async (message) => {
  const ticket = state.tickets[message.channel_id];
  if (!ticket || message.author_bot) return;
  const text = String(message.content || "").trim();
  try {
    if (/^link:\s*/i.test(text)) {
      await worker("/link-account", { method: "POST", body: JSON.stringify({ code: text.replace(/^link:\s*/i, ""), yapin_user_id: message.author_id, yapin_username: message.author?.username || message.username || "" }) });
      await bot.send(message.channel_id, "CrystalOS account linked. Now send `game: <catalogue id>` and `evidence: <proof>`.");
    } else if (/^game:\s*/i.test(text)) {
      await worker("/select-game", { method: "POST", body: JSON.stringify({ ticket_id: ticket.id, game_id: text.replace(/^game:\s*/i, "").trim() }) });
      await bot.send(message.channel_id, "Game selected. Send `evidence: <proof>` when ready.");
    } else if (/^evidence:\s*/i.test(text)) {
      await worker("/submit-evidence", { method: "POST", body: JSON.stringify({ ticket_id: ticket.id, evidence: text.replace(/^evidence:\s*/i, "").trim() }) });
      await bot.send(message.channel_id, "Evidence submitted. A verified staff member must review this ticket.");
      await bot.send(message.channel_id, "Staff actions:", { components: [new Row(Button.success("VERIFY USER", `ticket:approve:${ticket.id}`), Button.danger("DON'T VERIFY USER", `ticket:reject:${ticket.id}`))] });
    }
  } catch (error) {
    await bot.send(message.channel_id, `Verification could not continue: ${error.code || "BACKEND_FAILURE"}.`);
  }
});

bot.onButton(/^ticket:(approve|reject):(.+)$/, async (interaction) => {
  const [, decision, ticketId] = interaction.custom_id.match(/^ticket:(approve|reject):(.+)$/);
  try {
    const result = await worker("/decide", { method: "POST", body: JSON.stringify({ ticket_id: ticketId, actor_yapin_id: interaction.user_id, decision: decision === "approve" ? "approve" : "reject" }) });
    const status = result.ticket?.status || result.status || decision;
    await interaction.update({ content: status === "approved" ? "Ownership verified. The game will appear after the user refreshes CrystalOS." : "Ownership was not verified. No game access was granted.", components: [] });
  } catch (error) {
    const message = error.code === "NOT_STAFF" || error.code === "STAFF_REVOKED" ? "You are not authorized verification staff." : error.code === "ALREADY_PROCESSED" ? "This ticket has already been processed." : "Verification backend failure. No ownership change was confirmed.";
    await interaction.ephemeral(message);
  }
});

await bot.start();
