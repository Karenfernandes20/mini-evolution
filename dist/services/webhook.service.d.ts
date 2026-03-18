declare class WebhookService {
    dispatch(instanceKey: string, event: string, data: Record<string, unknown>): Promise<void>;
}
export declare const webhookService: WebhookService;
export {};
