import Foundation

/// One email after `EmailSource` fetched it and reduced HTML to readable text.
/// Treat `plainText`/`subject` as untrusted input — validate at the parser boundary.
public struct RawEmail: Equatable, Sendable {
    public let messageId: String
    public let from: String
    public let subject: String
    public let receivedAt: Date
    public let plainText: String   // HTML already stripped upstream

    public init(
        messageId: String,
        from: String,
        subject: String,
        receivedAt: Date,
        plainText: String
    ) {
        self.messageId = messageId
        self.from = from
        self.subject = subject
        self.receivedAt = receivedAt
        self.plainText = plainText
    }
}
