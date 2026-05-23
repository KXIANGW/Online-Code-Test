// Minimal program used by `make verify-language LANG=cpp17` to confirm that
// the language's Dockerfile produces a working compile+run pipeline through
// IsolateEngine. Filename must match languages.yaml `source.filename`.
#include <iostream>

int main() {
    std::cout << "hello cpp17" << std::endl;
    return 0;
}
