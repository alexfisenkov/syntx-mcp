import {
  ACCOUNT_CONTRACT_EVIDENCE,
  ACCOUNT_SOURCE_BUILD,
  type SyntxSubscription
} from "../adapter/syntx/account-decoder.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";

export interface AccountStatusResult {
  balance: { unit: "tokens"; available: string | null };
  subscription: SyntxSubscription;
  contract_evidence: typeof ACCOUNT_CONTRACT_EVIDENCE;
  source_build: typeof ACCOUNT_SOURCE_BUILD;
  observed_at: string;
}

/** Read-only snapshot; balance is not an enforceable spending cap or quote. */
export class AccountStatusService {
  constructor(
    private readonly client: SyntxHttpClient,
    private readonly now: () => number = Date.now
  ) {}

  async getAccountStatus(signal?: AbortSignal): Promise<AccountStatusResult> {
    // Sequential reads avoid leaving sibling I/O running after a failed read.
    // Each call independently checks the exact linked attempt's credential.
    const balance = await this.client.getAccountBalance(signal);
    const subscription = await this.client.getSubscription(signal);
    return {
      balance: { unit: "tokens", available: balance.available },
      subscription,
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(this.now()).toISOString()
    };
  }
}
