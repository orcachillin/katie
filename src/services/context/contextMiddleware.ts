import { NextFunction, Request, Response } from "express";
import Core from "../../core.js";

export default function ContextMiddleware(req: Request, res: Response, next: NextFunction) {
    const store = Core.services.context.open();

    Object.assign(store, req.query);

    store.method = req.method;
    store.path = req.query.path || req.path;
    store.query = req.query
    store.session = req.body.session;
    store.req = req;
    store.res = res;

    res.setHeader("x-request-id", store._rid);

    // run the rest of the request inside the ALS context
    const als = (Core.services.context as any).constructor.als;
    als.run(store, () => next());
}
