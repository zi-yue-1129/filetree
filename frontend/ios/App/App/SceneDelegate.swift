import UIKit
import Capacitor
import FileNexusNativePlugin

/// Connects the Capacitor scene to native upload and backup lifecycle work.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    /// Construct the bridge and forward initial URL contexts to Capacitor.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) -> Void {
        guard let windowScene = scene as? UIWindowScene else { return }
        let appWindow: UIWindow = UIWindow(windowScene: windowScene)
        appWindow.rootViewController = CAPBridgeViewController()
        appWindow.makeKeyAndVisible()
        window = appWindow
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    /// Resume native work after foregrounding, including filenexus share wakeups.
    func sceneDidBecomeActive(_ scene: UIScene) -> Void { FileNexusLifecycle.active() }

    /// Submit best-effort backup task requests before suspension.
    func sceneDidEnterBackground(_ scene: UIScene) -> Void { FileNexusLifecycle.background() }

    /// Forward custom schemes; shared file paths are read only from entitled storage.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) -> Void {
        FileNexusLifecycle.active()
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    /// Forward supported universal links to Capacitor.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) -> Void {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
