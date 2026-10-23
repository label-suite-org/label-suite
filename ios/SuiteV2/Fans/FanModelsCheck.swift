import Foundation

@main struct FanModelsCheck {
    static func main() throws {
        let drop = FanDropDraft(drop: nil, artistID: "artist-fixture")
        let object = try JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: drop.input)) as! [String: Any]
        assert(object["release_id"] is NSNull)
        let content = object["content"] as! [String: Any]
        assert(content["success_url"] is NSNull && content["artwork_url"] is NSNull)
        assert(object["id"] == nil && object["expected_revision"] == nil)
        let data = Data(#"{"id":"message-fixture","revision":2,"audience":{"artist_id":"artist-fixture","city":"Denver"},"content":{"subject":"Song","body":"Listen","link_url":null,"link_label":"Listen"},"status":"draft","scheduled_at":null,"recipient_count":0,"failure_code":null,"report":null}"#.utf8)
        let message = try JSONDecoder().decode(BackendFanMessage.self, from: data)
        var draft = FanMessageDraft(message: message, artistID: "ignored")
        draft.audience.city = ""
        assert(draft.input["expected_revision"] as? Int == 2)
        assert((draft.input["audience"] as? [String: Any])?["city"] == nil)
        assert((draft.input["content"] as? [String: Any])?["link_url"] is NSNull)
        let preview = try JSONDecoder().decode(BackendFanPreview.self, from: Data(#"{"count":1,"audience":[{"id":"fan-fixture","email":"fan@example.test","name":"Fan","city":"Denver","tags":[],"confirmed_at":null}],"limit_exceeded":false,"preview_hash":"hash","html":"<p>Hello</p>"}"#.utf8))
        assert(preview.audience.count == preview.count && preview.audience[0].status == nil)
        print("PASS fan draft nulls, saved revisions, optional filters, and preview decoding")
    }
}
