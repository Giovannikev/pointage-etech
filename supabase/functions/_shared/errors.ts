/** Error carrying the HTTP status returned to the caller. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "HttpError"
  }
}
