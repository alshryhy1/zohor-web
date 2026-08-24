import Foundation

enum ScreenPhase<Value: Equatable>: Equatable {
    case loading
    case empty
    case populated(Value)
    case error(String)

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}
