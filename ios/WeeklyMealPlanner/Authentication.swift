import UIKit
import Foundation
import AuthenticationServices
import CryptoKit
import FirebaseAuth
import FirebaseCore
import GoogleSignIn

@MainActor
final class IdentityFlow: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<(AuthCredential, String?), Error>?
    private var nonce = ""
    private var controller: ASAuthorizationController?
    func credential(provider: String) async throws -> (AuthCredential, String?) {
        if provider == "google.com" {
            guard let clientID = FirebaseApp.app()?.options.clientID,
                  let window = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow }),
                  let presenter = window.rootViewController else {
                throw NSError(domain: "MealAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Google登入設定尚未完成。"])
            }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let token = result.user.idToken?.tokenString else { throw NSError(domain: "MealAuth", code: 2) }
            return (GoogleAuthProvider.credential(withIDToken: token, accessToken: result.user.accessToken.tokenString), nil)
        }
        guard continuation == nil else { throw NSError(domain: "MealAuth", code: 3) }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NSError(domain: "MealAuth", code: 4) }
        nonce = bytes.map { String(format: "%02x", $0) }.joined()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow }) ?? ASPresentationAnchor()
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { continuation = nil; self.controller = nil }
        guard let value = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = value.identityToken, let token = String(data: data, encoding: .utf8) else {
            continuation?.resume(throwing: NSError(domain: "MealAuth", code: 5)); return
        }
        let credential = OAuthProvider.appleCredential(withIDToken: token, rawNonce: nonce, fullName: value.fullName)
        let code = value.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        continuation?.resume(returning: (credential, code))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error); continuation = nil; self.controller = nil
    }
}
