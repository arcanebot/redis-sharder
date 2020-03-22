import Redis, { CallbackFunction } from 'ioredis';
import { GatewayClient } from '../GatewayClient';
import { Base } from 'eris';
import { DataClient } from '../DateClient';

export interface PubSubOptions {
    redisPort?: number,
    redisPassword?: string,
    redisHost?: string,
};

export class PubSub {
    
    private subRedis: Redis.Redis | undefined;
    private pubRedis: Redis.Redis | undefined;
    private client: GatewayClient | DataClient;
    private options: any;

    private returns: Map<string, CallbackFunction> = new Map();
    private evals: Map<string, any> = new Map();

    constructor(options:PubSubOptions, client: GatewayClient | DataClient) {
        this.client = client;
        this.options = options;

        this.initialize();
        this.setupSubscriptions();
    };

    private initialize(): void {
        this.pubRedis = new Redis(this.options.redisPort, this.options.redisHost, {
            password: this.options.redisPassword,
        });
        this.subRedis = new Redis(this.options.redisPort, this.options.redisHost, {
            password: this.options.redisPassword,
        });

        const thispls = this;
        this.subRedis.on('message', this.handleMessage.bind(thispls));
    };

    private setupSubscriptions(): void {
        this.subRedis?.subscribe('getGuild', 'returnGuild', 'getUser', 'returnUser', 'eval', 'returnEval');
    };

    private handleMessage(channel: string, msg: any) {
        let message:any = JSON.parse(msg);

        if (channel === 'getGuild') {
            if (this.client instanceof DataClient) return;
            const guild = this.client.guilds.get(message.id);
            if (guild) this.pubRedis?.publish('returnGuild', JSON.stringify(guild?.toJSON()));
        };

        if (channel === 'returnGuild') {
            let toReturn: CallbackFunction | undefined = this.returns.get(`guild_${message.id}`);
            if (toReturn) {
                toReturn(message);
                this.returns.delete(`guild_${message.id}`);
            };
        };

        if (channel === 'getUser') {
            if (this.client instanceof DataClient) return;
            const user = this.client.users.get(message.id);
            if (user) this.pubRedis?.publish('returnUser', JSON.stringify(user?.toJSON()));
        };

        if (channel === 'returnUser') {
            let toReturn: CallbackFunction | undefined = this.returns.get(`user_${message.id}`);
            if (toReturn) {
                toReturn(message);
                this.returns.delete(`user_${message.id}`);
            };
        };

        if (channel === 'eval') {
            if (!this.options.redisPassword) return;
            try {
                let output = eval(message.script);

                // to do
                // try to .toJSON()
                if (Array.isArray(output)) output = output.map((item: any) => {
                    if (item instanceof Base) return item.toJSON();
                    else return item;
                });
                if (output instanceof Base) output = output.toJSON();

                this.pubRedis?.publish('returnEval', JSON.stringify({ output: output, id: message.id }));
            } catch {
                this.pubRedis?.publish('returnEval', JSON.stringify({ output: undefined, id: message.id }));
            };
        };

        if (channel === 'returnEval') {
            if (!this.options.redisPassword) return;
            let toReturn: CallbackFunction | undefined = this.returns.get(`eval_${message.id}`);
            if (toReturn) {
                const evals = this.evals.get(message.id) || [];
                evals.push(message.output);
                this.evals.set(message.id, evals);

                if (this.client instanceof DataClient) {
                    if (Number(this.client.maxShards) / this.client.shardsPerCluster === evals.length) {
                        this.returns.delete(`eval_${message.id}`);
                        this.evals.delete(message.id);
                        toReturn(evals);
                    };
                } else if (Number(this.client.options.maxShards) / this.client.shardsPerCluster === evals.length) {
                    this.returns.delete(`eval_${message.id}`);
                    this.evals.delete(message.id);
                    toReturn(evals);
                };
            };
        };
    };

    getGuild(id: string): Promise<any | undefined> {
        return new Promise((resolve, _reject) => {
            this.returns.set(`guild_${id}`, resolve);
            this.pubRedis?.publish('getGuild', JSON.stringify({ id: id }));

            setTimeout(() => {
                this.returns.delete(`user_${id}`);
                resolve(undefined);
            }, 2000);
        });
    };

    getUser(id: string): Promise<any | undefined> {
        return new Promise((resolve, _reject) => {
            this.returns.set(`user_${id}`, resolve);
            this.pubRedis?.publish('getUser', JSON.stringify({ id: id }));

            setTimeout(() => {
                this.returns.delete(`user_${id}`);
                resolve(undefined);
            }, 2000);
        });
    };

    evalAll(script: string, timeout?: number): Promise<any | undefined> {
        return new Promise((resolve, _reject) => {
            const id: number = Date.now()+Math.random();
            this.returns.set(`eval_${id}`, resolve);
            this.pubRedis?.publish('eval', JSON.stringify({ id: id, script: script }));

            setTimeout(() => {
                this.returns.delete(`eval_${id}`);
                resolve(undefined);
            }, timeout || 5000);
        });
    };
};