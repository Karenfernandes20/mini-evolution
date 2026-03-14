export type InstanceStatus = 'connected' | 'disconnected' | 'connecting' | 'qrcode';

export interface InstanceData {
  key: string;
  name?: string;
  token: string;
  status: InstanceStatus;
  phone?: string;
  webhookUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
