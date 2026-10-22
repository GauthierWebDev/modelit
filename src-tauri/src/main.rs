// Pas de console supplémentaire sous Windows en version de production.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    modelit_lib::run();
}
