export interface OpenOrder {
  marketId: string;
  marketDescription?: string;
  eventDate?: string;
  side: string;
  quantity: string;
  price: string;
}

export interface ExposurePosition {
  marketId: string;
  description: string;
  eventDate?: string;
  netContracts: string;
  notional: string;
  lastUpdated: string;
}

export interface AgentExposure {
  agentId: string;
  name: string;
  accountId: string;
  balance: string;
  openOrders: OpenOrder[];
  positions: ExposurePosition[];
}

export interface ExposureSnapshot {
  generatedAt: string;
  agents: AgentExposure[];
}
