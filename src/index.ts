import { DurableObject } from "cloudflare:workers";
import { z } from "zod"

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject {
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}
}

const seatId = z.string()

type SeatId = z.infer<typeof seatId>

const occupant = z.string().nullish()

const seatList = z.object({
	seatId,
	occupant
})

type SeatList = z.infer<typeof seatList>

function charToNumber(char: string) {
	return char.toLowerCase().charCodeAt(0) - 96;
}

// Function to convert a number back to a character
function numberToChar(num: number) {
	return String.fromCharCode(num + 96);
}

export class SqliteTestClass extends DurableObject {

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	sql = this.ctx.storage.sql;

	createDummyFlight() {
		const flightOccupancy = Math.round(Math.random() * 100)
		const perRow = 6
		const cols = 2

		const totalRows = flightOccupancy / perRow

		let seatListHolder: SeatList[][] = []

		for (let i = 0; i <= totalRows; i++) {

			const rowNum = i + 1

			const seats = Array.from({ length: perRow }).map((_, i) => {
				const seat: SeatList = {
					occupant: null,
					seatId: `${rowNum}${numberToChar(i + 1).toUpperCase()}`
				}
				return seat
			})

			seatListHolder.push(seats)

		}

		return seatListHolder.flat()


	}
	// Application calls this when the flight is first created to set up the seat map.
	initializeFlight(seatList: SeatList[]) {
		this.sql.exec(`
      CREATE TABLE IF NOT EXISTS seats (
        seatId TEXT PRIMARY KEY,  -- e.g. "3B"
        occupant TEXT             -- null if available
      )
    `);

		for (let seat of seatList) {
			this.sql.exec(`INSERT INTO seats VALUES (?, null)`, seat.seatId);
		}
	}

	// Get a list of available seats.
	getAvailable() {
		// NOTE: just seaId here, as we're querying for `IS NULL`
		let results: SeatId[] = [];

		// Query returns a cursor.
		let cursor = this.sql.exec(`SELECT seatId FROM seats WHERE occupant IS NULL`);

		console.log({ cursor })

		// Cursors are iterable.
		for (let row of cursor) {
			// Each row is an object with a property for each column.
			const rowGot = Object.values(row)
			const tryParse = seatId.safeParse(rowGot[0])

			if (tryParse.success) {
				results.push(tryParse.data);
			}
		}

		return results;
	}

	// Assign passenger to a seat.
	assignSeat(seatInfo: SeatList) {
		const { seatId, occupant } = seatInfo
		//
		// Check that seat isn't occupied.
		let cursor = this.sql.exec(`SELECT occupant FROM seats WHERE seatId = ?`, seatId);
		let result = [...cursor][0];  // Get the first result from the cursor.
		if (!result) {
			throw new Error("No such seat: " + seatId);
		}
		if (result.occupant !== null) {
			throw new Error("Seat is occupied: " + seatId);
		}

		// If the occupant is already in a different seat, remove them.
		this.sql.exec(`UPDATE seats SET occupant = null WHERE occupant = ?`, occupant);

		// Assign the seat. Note: We don't have to worry that a concurrent request may
		// have grabbed the seat between the two queries, because the code is synchronous
		// (no `await`s) and the database is private to this Durable Object. Nothing else
		// could have changed since we checked that the seat was available earlier!
		this.sql.exec(`UPDATE seats SET occupant = ? WHERE seatId = ?`, occupant, seatId);
	}
}


const methods = z.enum(["available", "assign"])
const planeId = z.string()


export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// We will create a `DurableObjectId` using the pathname from the Worker request
		// This id refers to a unique instance of our 'MyDurableObject' class above


		const urlPath = new URL(request.url).pathname

		if (urlPath.includes("seats")) {

			const room = urlPath.split("/").filter(x => x.length)

			if (!room.length) throw new Error("ffs")


			if (room.length !== 3) throw new Error("wrong methods")


			const method = methods.parse(room[1])

			console.log({ method })

			const roomId = room[room.length - 1]

			if (roomId === "seats") {
				throw new Error("incorrect!")
			}

			let id: DurableObjectId = env.SQLITE_TEST.idFromName(roomId);

			let planeStub = env.SQLITE_TEST.get(id);



			try {
				const availableRows = await planeStub.getAvailable()
				return Response.json(availableRows)

			} catch (error) {
				console.error(error)
				console.info(`failed to get table for: ${id}\nrunning init`)

				const totalRows = await planeStub.createDummyFlight()
				await planeStub.initializeFlight(totalRows)
				const availableRows = await planeStub.getAvailable()
				return Response.json(availableRows)
			}

		}

		let id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName(urlPath);

		// This stub creates a communication channel with the Durable Object instance
		// The Durable Object constructor will be invoked upon the first call for a given id
		let stub = env.MY_DURABLE_OBJECT.get(id);

		const cfc = request.cf?.city

		const cfcLatLong = `${request.cf?.latitude}, ${request.cf?.longitude}`

		// We call the `sayHello()` RPC method on the stub to invoke the method on the remote
		// Durable Object instance
		const greetingFormat = cfc && cfcLatLong ? `${cfc}\t${cfcLatLong}` : "world"
		let greeting = await stub.sayHello(greetingFormat);

		return new Response(greeting);
	},
} satisfies ExportedHandler<Env>;
