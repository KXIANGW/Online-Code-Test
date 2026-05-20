import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("nginx websocket proxy contract", () => {
  it("forwards websocket upgrade headers for /api/", () => {
    const nginxConf = fs.readFileSync(path.resolve(__dirname, "../../nginx.conf"), "utf8");

    expect(nginxConf).toContain("map $http_upgrade $connection_upgrade");
    expect(nginxConf).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(nginxConf).toContain("proxy_set_header Connection $connection_upgrade;");
  });
});
