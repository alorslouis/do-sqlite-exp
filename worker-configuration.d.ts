// Generated by Wrangler by running `wrangler types`

interface Env {
	MY_DURABLE_OBJECT: DurableObjectNamespace<import("./src/index").MyDurableObject>;
	SQLITE_TEST: DurableObjectNamespace<import("./src/index").SqliteTestClass>;
}
