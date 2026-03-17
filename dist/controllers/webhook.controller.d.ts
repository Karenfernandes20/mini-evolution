import { Request, Response } from 'express';
export declare class WebhookController {
    setGlobal(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
}
export declare const webhookController: WebhookController;
