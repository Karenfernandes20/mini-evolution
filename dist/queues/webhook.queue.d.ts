import { Queue, Worker } from 'bullmq';
export declare const webhookQueue: Queue<any, any, string, any, any, string>;
export declare const webhookWorker: Worker<any, any, string>;
