declare class WebhookService {
    dispatch(instanceKey: string, event: string, data: any): Promise<void>;
}
export declare const webhookService: WebhookService;
export {};
