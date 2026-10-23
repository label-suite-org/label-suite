import Foundation

struct BackendFansHome: Decodable {
    let drops: [BackendFanDrop]
    let messages: [BackendFanMessage]
    let artists: [FanArtistChoice]
    let releases: [FanReleaseChoice]
    let shows: [FanShowChoice]
    let email_enabled: Bool
    let broadcast_enabled: Bool
    let public_base_url: String
}
struct FanArtistChoice: Decodable, Identifiable { let id: String; let name: String; let image_url: String? }
struct FanReleaseChoice: Decodable, Identifiable { let id: String; let artist_id: String?; let title: String; let cover_art_url: String? }
struct FanShowChoice: Decodable, Identifiable { let id: String; let artist_id: String?; let title: String; let start_date: String?; let city: String? }
struct FanDropShow: Codable, Equatable { var event_id: String; var ticket_url: String? }
struct FanDropContent: Codable, Equatable {
    var title = ""
    var description = ""
    var artwork_url: String?
    var privacy_url = ""
    var success_url: String?
    var success_label = "Continue"
    var shows: [FanDropShow] = []
}
struct BackendFanDrop: Decodable, Identifiable {
    let id: String; let artist_id: String; let release_id: String?; let slug: String; let revision: Int
    let content: FanDropContent; let published_revision: Int?; let public_url: String?
}
struct FanDropDraft: Encodable, Equatable {
    var id: String?; var expected_revision: Int?; var artist_id: String; var release_id: String?; var slug: String
    var content: FanDropContent
    init(drop: BackendFanDrop?, artistID: String) {
        id = drop?.id; expected_revision = drop?.revision; artist_id = drop?.artist_id ?? artistID
        release_id = drop?.release_id; slug = drop?.slug ?? ""; content = drop?.content ?? FanDropContent()
    }
    // JSON null is part of the API contract for optional release and link fields.
    var input: [String: Any] {
        var values: [String: Any] = ["artist_id": artist_id, "release_id": release_id as Any? ?? NSNull(), "slug": slug,
            "content": ["title": content.title, "description": content.description, "artwork_url": content.artwork_url as Any? ?? NSNull(), "privacy_url": content.privacy_url, "success_url": content.success_url as Any? ?? NSNull(), "success_label": content.success_label, "shows": content.shows.map { ["event_id": $0.event_id, "ticket_url": $0.ticket_url as Any? ?? NSNull()] }] as [String: Any]]
        if let id, let expected_revision { values["id"] = id; values["expected_revision"] = expected_revision }
        return values
    }
}
struct FanAudienceRule: Codable, Equatable { var artist_id: String; var drop_id: String?; var city: String?; var tag: String? }
struct FanMessageContent: Codable, Equatable { var subject = ""; var body = ""; var link_url: String?; var link_label = "Read more" }
struct BackendFanReport: Decodable { let sent: Int; let delivered: Int; let uniqueClicks: Int; let hardBounces: Int; let softBounces: Int; let complaints: Int; let unsubscriptions: Int }
struct BackendFanMessage: Decodable, Identifiable {
    let id: String; let revision: Int; let audience: FanAudienceRule; let content: FanMessageContent
    let status: String; let scheduled_at: Date?; let recipient_count: Int; let failure_code: String?; let report: BackendFanReport?
}
struct FanMessageDraft: Equatable {
    var id: String?; var expected_revision: Int?; var audience: FanAudienceRule; var content: FanMessageContent
    init(message: BackendFanMessage?, artistID: String) {
        id = message?.id; expected_revision = message?.revision; audience = message?.audience ?? FanAudienceRule(artist_id: artistID); content = message?.content ?? FanMessageContent()
    }
    var input: [String: Any] {
        var rule: [String: Any] = ["artist_id": audience.artist_id]
        if let drop = audience.drop_id, !drop.isEmpty { rule["drop_id"] = drop }
        if let city = audience.city, !city.isEmpty { rule["city"] = city }
        if let tag = audience.tag, !tag.isEmpty { rule["tag"] = tag }
        var result: [String: Any] = ["audience": rule, "content": ["subject": content.subject, "body": content.body, "link_url": content.link_url as Any? ?? NSNull(), "link_label": content.link_label] as [String: Any]]
        if let id, let expected_revision { result["id"] = id; result["expected_revision"] = expected_revision }
        return result
    }
}
struct BackendFan: Codable, Identifiable {
    let id: String; let email: String; let name: String; let city: String; let tags: [String]
    let status: String?; let provider_suppressed: Bool?; let confirmed_at: Date?
}
struct BackendFanList: Decodable { let fans: [BackendFan] }
struct BackendFanPreview: Decodable { let count: Int; let audience: [BackendFan]; let limit_exceeded: Bool; let preview_hash: String; let html: String }
struct BackendFanHistory: Decodable {
    struct Signup: Decodable, Identifiable { let id: String; let drop_id: String; let show_id: String?; let created_at: Date; let confirmed_at: Date?; let email_status: String }
    struct Activity: Decodable, Identifiable { let id: String; let message_id: String; let kind: String; let occurred_at: Date }
    let signups: [Signup]; let activity: [Activity]
}
struct BackendFanTagResult: Decodable { let id: String; let tags: [String] }
