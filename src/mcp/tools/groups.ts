import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSock } from "../../whatsapp/connection.ts";
import {
  createGroup,
  groupParticipants,
  groupSetSubject,
  groupSetDescription,
  groupInviteLink,
  groupInfo,
  groupLeave,
} from "../../whatsapp/actions.ts";
import { assertMutationsAllowed } from "../../safety/index.ts";
import { jsonResult, textResult, safeHandler } from "../format.ts";

export function registerGroupTools(server: McpServer): void {
  server.tool(
    "group_info",
    { group_jid: z.string().describe("Group JID ending in @g.us") },
    safeHandler(async ({ group_jid }: any) => {
      const meta = await groupInfo(getSock(), group_jid);
      return jsonResult({
        jid: meta.id,
        subject: meta.subject,
        description: meta.desc,
        owner: meta.owner,
        size: meta.participants.length,
        participants: meta.participants.map((p) => ({ jid: p.id, admin: p.admin ?? null })),
      });
    }),
  );

  server.tool(
    "create_group",
    {
      subject: z.string().min(1),
      participants: z.array(z.string()).min(1).describe("Phone numbers or JIDs of initial members"),
    },
    safeHandler(async ({ subject, participants }: any) => {
      assertMutationsAllowed("create_group");
      const meta = await createGroup(getSock(), subject, participants);
      return jsonResult({ jid: (meta as any).id, subject });
    }),
  );

  server.tool(
    "group_update_participants",
    {
      group_jid: z.string(),
      participants: z.array(z.string()).min(1),
      action: z.enum(["add", "remove", "promote", "demote"]),
    },
    safeHandler(async ({ group_jid, participants, action }: any) => {
      assertMutationsAllowed("group_update_participants");
      const res = await groupParticipants(getSock(), group_jid, participants, action);
      return jsonResult(res);
    }),
  );

  server.tool(
    "group_set_subject",
    { group_jid: z.string(), subject: z.string().min(1) },
    safeHandler(async ({ group_jid, subject }: any) => {
      assertMutationsAllowed("group_set_subject");
      await groupSetSubject(getSock(), group_jid, subject);
      return textResult(`Group subject updated`);
    }),
  );

  server.tool(
    "group_set_description",
    { group_jid: z.string(), description: z.string() },
    safeHandler(async ({ group_jid, description }: any) => {
      assertMutationsAllowed("group_set_description");
      await groupSetDescription(getSock(), group_jid, description);
      return textResult(`Group description updated`);
    }),
  );

  server.tool(
    "group_invite_link",
    { group_jid: z.string() },
    safeHandler(async ({ group_jid }: any) => {
      const link = await groupInviteLink(getSock(), group_jid);
      return textResult(link);
    }),
  );

  server.tool(
    "group_leave",
    { group_jid: z.string() },
    safeHandler(async ({ group_jid }: any) => {
      assertMutationsAllowed("group_leave");
      await groupLeave(getSock(), group_jid);
      return textResult(`Left group ${group_jid}`);
    }),
  );
}
