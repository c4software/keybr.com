import { type Result } from "@keybr/result";
import { DatabaseError } from "../errors.ts";
import { PersistentResultStorage } from "./local.ts";
import { ResultSyncNamedUser, ResultSyncPublicUser } from "./remotesync.ts";
import {
  type LocalResultStorage,
  type ProgressListener,
  type RemoteResultSync,
  type ResultStorage,
} from "./types.ts";

export type OpenRequest =
  | {
      // Load our own data.
      readonly type: "private";
      readonly userId: string | null;
    }
  | {
      // Load data of a public user.
      readonly type: "public";
      readonly userId: string;
    };

export function openResultStorage(request: OpenRequest): ResultStorage {
  switch (request.type) {
    case "private": {
      const { userId } = request;
      if (userId == null) {
        const local = new PersistentResultStorage();
        return translateErrors(new ResultStorageOfAnonymousUser(local));
      } else {
        const local = new PersistentResultStorage();
        const remote = new ResultSyncNamedUser();
        return translateErrors(new ResultStorageOfNamedUser(local, remote));
      }
    }
    case "public": {
      const { userId } = request;
      const remote = new ResultSyncPublicUser(userId);
      return translateErrors(new ResultStorageOfPublicUser(remote));
    }
  }
}

export function translateErrors(storage: ResultStorage): ResultStorage {
  return new (class ErrorTranslator implements ResultStorage {
    async load(progressListener?: ProgressListener): Promise<Result[]> {
      try {
        return await storage.load(progressListener);
      } catch (err: any) {
        throw new DatabaseError("Cannot read records from database", {
          cause: err,
        });
      }
    }

    async append(
      results: readonly Result[],
      progressListener?: ProgressListener,
    ): Promise<void> {
      try {
        await storage.append(results, progressListener);
      } catch (err: any) {
        throw new DatabaseError("Cannot add records to database", {
          cause: err,
        });
      }
    }

    async clear(): Promise<void> {
      try {
        await storage.clear();
      } catch (err: any) {
        throw new DatabaseError("Cannot clear database", {
          cause: err,
        });
      }
    }
  })();
}

export class ResultStorageOfAnonymousUser implements ResultStorage {
  private readonly _local: LocalResultStorage;

  constructor(local: LocalResultStorage) {
    this._local = local;
  }

  async load(
    progressListener = (total: number, current: number) => {},
  ): Promise<Result[]> {
    return await this._local.load();
  }

  async append(
    results: readonly Result[],
    progressListener = (total: number, current: number) => {},
  ): Promise<void> {
    await this._local.append(results);
  }

  async clear(): Promise<void> {
    await this._local.clear();
  }
}

export class ResultStorageOfNamedUser implements ResultStorage {
  private readonly _local: LocalResultStorage;
  private readonly _remote: RemoteResultSync;

  constructor(local: LocalResultStorage, remote: RemoteResultSync) {
    this._local = local;
    this._remote = remote;
  }

  async load(
    progressListener = (total: number, current: number) => {},
  ): Promise<Result[]> {
    const results = await this._remote.receive(progressListener);
    if (results.length > 0) {
      return results;
    } else {
      const results = await this._local.load();
      if (results.length > 0) {
        await this._remote.send(results, progressListener);
        await this._local.clear();
        return results;
      }
    }
    return [];
  }

  async append(
    results: readonly Result[],
    progressListener = (total: number, current: number) => {},
  ): Promise<void> {
    await this._remote.send(results, progressListener);
  }

  async clear(): Promise<void> {
    await this._remote.clear();
  }
}

export class ResultStorageOfPublicUser implements ResultStorage {
  private readonly _remote: RemoteResultSync;

  constructor(remote: RemoteResultSync) {
    this._remote = remote;
  }

  async load(
    progressListener = (total: number, current: number) => {},
  ): Promise<Result[]> {
    return await this._remote.receive(progressListener);
  }

  async append(
    results: readonly Result[],
    progressListener = (total: number, current: number) => {},
  ): Promise<void> {
    throw new Error("Disabled");
  }

  async clear(): Promise<void> {
    throw new Error("Disabled");
  }
}
