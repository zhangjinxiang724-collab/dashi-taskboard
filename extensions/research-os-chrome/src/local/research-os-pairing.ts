import { pairResearchOs, revokeResearchOsClient } from "./research-os-client";
import {
  persistCaptureConnection,
  type CaptureConnection,
  type ExtensionLocalStorage,
} from "./research-os-connection";

type PairingDependencies = {
  pair?: typeof pairResearchOs;
  revoke?: typeof revokeResearchOsClient;
  pairedAt?: () => string;
};

export async function pairAndPersistResearchOs(
  storage: ExtensionLocalStorage,
  endpoint: string,
  code: string,
  dependencies: PairingDependencies = {},
): Promise<CaptureConnection> {
  const pair = dependencies.pair ?? pairResearchOs;
  const revoke = dependencies.revoke ?? revokeResearchOsClient;
  const { token, client } = await pair(endpoint, code);

  try {
    return await persistCaptureConnection(storage, {
      schemaVersion: 1,
      endpoint,
      clientId: client.id,
      token,
      pairedAt: (dependencies.pairedAt ?? (() => new Date().toISOString()))(),
    });
  } catch (error) {
    await revoke(endpoint, client.id).catch(() => undefined);
    throw error;
  }
}
