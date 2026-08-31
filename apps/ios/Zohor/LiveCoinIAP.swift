import Foundation
import StoreKit

@MainActor
enum LiveCoinIAP {
    static let productIds: [String] = [
        "lahza.coins.handful",
        "lahza.coins.chest",
        "lahza.coins.vault",
        "lahza.coins.empire",
    ]

    static func productId(forPackId packId: String) -> String {
        "lahza.coins.\(packId)"
    }

    static func packId(forProductId productId: String) -> String? {
        guard productId.hasPrefix("lahza.coins.") else { return nil }
        return String(productId.dropFirst("lahza.coins.".count))
    }

    static func loadProducts() async throws -> [Product] {
        try await Product.products(for: productIds)
    }

    static func displayPrice(for packId: String, products: [Product]) -> String? {
        let id = productId(forPackId: packId)
        return products.first(where: { $0.id == id })?.displayPrice
    }

    static func purchase(packId: String) async throws -> PurchaseResult {
        let productId = productId(forPackId: packId)
        let products = try await Product.products(for: [productId])
        guard let product = products.first else {
            throw LiveCoinIAPError.productMissing
        }
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            return PurchaseResult(
                transactionId: String(transaction.id),
                productId: transaction.productID,
                jwsRepresentation: verification.jwsRepresentation,
                transaction: transaction
            )
        case .userCancelled:
            throw LiveCoinIAPError.cancelled
        case .pending:
            throw LiveCoinIAPError.pending
        @unknown default:
            throw LiveCoinIAPError.failed
        }
    }

    struct PurchaseResult {
        let transactionId: String
        let productId: String
        let jwsRepresentation: String
        let transaction: Transaction
    }

    private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw LiveCoinIAPError.unverified
        case .verified(let safe):
            return safe
        }
    }
}

enum LiveCoinIAPError: LocalizedError {
    case productMissing
    case cancelled
    case pending
    case unverified
    case failed

    var errorDescription: String? {
        switch self {
        case .productMissing:
            return "الحزمة غير متاحة حاليًا."
        case .cancelled:
            return "أُلغي الشراء."
        case .pending:
            return "الشراء معلّق."
        case .unverified:
            return "تعذر تأكيد عملية الشراء."
        case .failed:
            return "تعذر إتمام الشراء."
        }
    }
}
