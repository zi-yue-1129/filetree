require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# CocoaPods spec for the iOS half of the FileNexusNative plugin (SPM is the default in Capacitor 8).
Pod::Spec.new do |s|
  s.name = 'FilenexusNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/zi-yue-1129/filetree'
  s.author = package['author']
  s.source = { :git => 'https://github.com/zi-yue-1129/filetree.git', :tag => "v#{package['version']}" }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
