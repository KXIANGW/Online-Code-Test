#include <iostream>
int main() {
    int* ptr = nullptr;
    *ptr = 42;  // null pointer dereference — should produce RE
    return 0;
}
