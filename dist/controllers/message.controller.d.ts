import { Request, Response } from 'express';
export declare class MessageController {
    sendText(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    sendMedia(req: Request, res: Response, type: 'image' | 'audio' | 'video' | 'document'): Promise<Response<any, Record<string, any>>>;
    sendImage(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    sendAudio(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    sendVideo(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    sendDocument(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    sendReaction(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
}
export declare const messageController: MessageController;
