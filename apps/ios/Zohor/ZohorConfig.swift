import Foundation

enum ZohorConfigError: Error, LocalizedError {
    case missingValue(String)
    case invalidURL(String)

    var errorDescription: String? {
        switch self {
        case .missingValue(let key): return "Missing configuration value: \(key)"
        case .invalidURL(let key): return "Invalid URL configuration value: \(key)"
        }
    }
}

struct ZohorRuntimeConfig {
    let supabaseURL: URL
    let supabaseAnonKey: String
    let bffBaseURL: URL

    static func load() throws -> ZohorRuntimeConfig {
        let supabaseURL = try urlValue("ZOHOR_SUPABASE_URL")
        let anonKey = try stringValue("ZOHOR_SUPABASE_ANON_KEY")
        let bffURL = (try? urlValue("ZOHOR_BFF_BASE_URL")) ?? supabaseURL
        return ZohorRuntimeConfig(supabaseURL: supabaseURL, supabaseAnonKey: anonKey, bffBaseURL: bffURL)
    }

    private static func stringValue(_ key: String) throws -> String {
        if let env = ProcessInfo.processInfo.environment[key], !env.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return env.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let value = Bundle.main.object(forInfoDictionaryKey: key) as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        throw ZohorConfigError.missingValue(key)
    }

    private static func urlValue(_ key: String) throws -> URL {
        let raw = try stringValue(key)
        guard let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else {
            throw ZohorConfigError.invalidURL(key)
        }
        return url
    }
}
