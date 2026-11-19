import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentCardSignatureEvidence } from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { extractSenPart, userSenMessage } from "@red-cup-engineering/a2a-engine/sen-part";
import { a2aResultParts } from "@red-cup-engineering/a2a-engine/v1-core";
import { sendSenTask } from "@red-cup-engineering/a2a-client/sen-part";
import { observationProtocol } from "@red-cup-engineering/youtube-public-channel-feed-observation-cell/protocol";
import { NODE_ROOT } from "./federation.mjs";

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

export function loadPublicFeedProvider(path = join(NODE_ROOT, "content/config/youtube-public-feed-observation-agent.json")) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.type !== "YouTubePublicFeedObservationProviderBinding" || value.provider !== "urn:ame:youtube-public-channel-feed-observation-cell"
      || typeof value.agentUrl !== "string" || !value.agentUrl.endsWith("/.well-known/agent-card.json") || !NI.test(value.expectedAgentCardIdentity ?? "")
      || value.operation !== "observe-youtube-public-channel-feed") throw new TypeError("YouTube public-feed provider binding is malformed");
  return Object.freeze({ ...value });
}

export function createPublicFeedClient({ binding = loadPublicFeedProvider(), send = sendSenTask, cardEvidence = agentCardSignatureEvidence, timeoutMs = 120_000 } = {}) {
  async function observe(channelId, requestId = randomUUID()) {
    if (!/^UC[A-Za-z0-9_-]{20,}$/u.test(channelId ?? "")) throw new TypeError("public-feed client requires one immutable YouTube channel ID");
    const input = { kind: "org.emsenn.youtube-public-channel-feed-observation.request.v1", requestId, channelId };
    const request = observationProtocol.encodeRequest(binding.operation, input);
    const message = userSenMessage(request.bytes, "youtube-public-channel-feed-observation-request.sen.cbor", randomUUID());
    const exchange = await send({ agentUrl: binding.agentUrl, message, requireSignature: true, signal: AbortSignal.timeout(timeoutMs) });
    const identity = cardEvidence(exchange.agentCard).card;
    if (identity !== binding.expectedAgentCardIdentity) throw new TypeError("YouTube public-feed provider Agent Card identity changed");
    const output = extractSenPart(a2aResultParts(exchange.result));
    const response = observationProtocol.admitResponse(output.bytes, output.ni);
    if (response.request !== exchange.inputNi || response.disposition !== "accepted" || response.reason !== null
        || response.result?.provider !== binding.provider || response.result?.channelId !== channelId) throw new TypeError(`YouTube public-feed provider refused or returned a foreign result: ${response.reason ?? "invalid delivery"}`);
    return Object.freeze({ result: response.result, evidence: Object.freeze({ agentCardIdentity: identity, inputNi: exchange.inputNi, outputNi: exchange.outputNi }) });
  }
  return Object.freeze({ observe });
}
