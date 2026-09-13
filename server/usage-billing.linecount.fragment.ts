    const restSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-rest.ts"), "utf8");
    const helperSrc = fs.readFileSync(path.join(__dirname, "gemini-clinical-helpers.ts"), "utf8");
    const combined =
      serverSrc.split("\n").length + restSrc.split("\n").length + helperSrc.split("\n").length;
    assert.ok(
      combined >= 649,
      `server.ts generate-soap plus gemini-clinical-rest/helpers must stay at/above main server.ts (649); got ${combined}`
    );
