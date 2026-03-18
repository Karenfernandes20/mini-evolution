import { NextFunction, Request, Response } from 'express';
export declare const authMiddleware: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
