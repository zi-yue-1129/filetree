import UIKit
import Capacitor
import FileNexusNativePlugin

/// Starts native services even when iOS wakes the app for background transfers.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    /// Register background task handlers before application launch returns.
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FileNexusLifecycle.launch()
        return true
    }

    /// Hand background transfer completion to the persistent native engine.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) -> Void {
        FileNexusLifecycle.backgroundSession(identifier, completion: completionHandler)
    }

    /// Configure the single Capacitor scene.
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration: UISceneConfiguration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}
