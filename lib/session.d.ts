declare module Express {
    export interface Request {
        session: Session;
    }

    export interface Session {
        _token: string;
    }
}
