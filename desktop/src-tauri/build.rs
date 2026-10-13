//! Compile Tauri's configuration, permissions, and bundled assets.

fn main() {
    println!("cargo:rerun-if-changed=../generated/bootstrap.js");
    tauri_build::build();
}
