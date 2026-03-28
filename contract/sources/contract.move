module test::contract;

use sui::event;

public struct SmallEvent has copy, drop {}

public entry fun test_call() {
    event::emit(SmallEvent{});
}
