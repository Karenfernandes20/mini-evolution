import { Request, Response } from 'express';
export declare class InstanceController {
    create(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    connect(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    list(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    status(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    delete(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    restart(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
}
export declare const instanceController: InstanceController;
