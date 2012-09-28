
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const SPAWN = require("child_process").spawn;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const CREDENTIALS_SSH = require("sourcemint-credentials-js/lib/ssh");



exports.ssh = function(pm, options) {

    ASSERT(typeof options.sshPrivateKeyPath !== "undefined", "`config.sshPrivateKeyPath` is required!");

    var privateKey = new CREDENTIALS_SSH.PrivateKey(pm.context.credentials, options.sshPrivateKeyPath);

    return privateKey.ensureInAuthenticationAgent().then(function() {

        var deferred = Q.defer();

        var sshOptions = [
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "PasswordAuthentication=no",
            "-o", "IdentityFile=" + privateKey.path
        ];

        var args = sshOptions.concat([
            options.username + "@" + options.hostname,
            "-t", "-t",
            // @see http://serverfault.com/questions/167416/change-directory-automatically-on-ssh-login
            // TODO: Load custom features into `bash`.
            'cd "' + options.initialPath + '"; bash --login'
        ]);

        TERM.stdout.writenl("\0cyan(Running: ssh " + args.join(" ") + " (cwd: " + pm.context.package.path + ")\0)");

        var proc = SPAWN("ssh", args, {
            cwd: pm.context.package.path,
            stdio: "inherit"    // NodeJS 0.8+
        });
        proc.on("error", function(err) {
            deferred.reject(err);
        });
        proc.on("exit", function(code) {
            deferred.resolve();
        });
        // NodeJS 0.6
        if (/^v0\.6\./.test(process.version)) {
            TERM.stdout.writenl("\0orange([sm] NOTE: For best results use NodeJS 0.8 on your client!\0)");
            proc.stdout.on("data", function(data) {
                process.stdout.write(data);
            });
            proc.stderr.on("data", function(data) {
                process.stderr.write(data);
            });
            process.stdin.resume();
            process.stdin.on("data", function (chunk) {
                // TODO: For some reason this input gets printed to process.stdout after hitting return.
                proc.stdin.write(chunk);
            });
        }
        return deferred.promise;
    });
}

exports.deploy = function(pm, options) {

    ASSERT(typeof options.sshPrivateKeyPath !== "undefined", "`config.sshPrivateKeyPath` is required!");

    var privateKey = new CREDENTIALS_SSH.PrivateKey(pm.context.credentials, options.sshPrivateKeyPath);

    return privateKey.ensureInAuthenticationAgent().then(function() {

        if (typeof options.targetPath !== "undefined" && typeof options.data !== "undefined") {

            var sshOptions = [
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "PasswordAuthentication=no",
                "-o", "IdentityFile=" + privateKey.path
            ];

            return call("ssh", pm.context.package.path, sshOptions.concat([
                options.username + "@" + options.hostname,
                "cat > " + options.targetPath
            ]), {
                stdin: options.data
            });
        }
        else if (typeof options.scriptPath !== "undefined") {

            var script = FS.readFileSync(options.scriptPath).toString();

            if (typeof options.scriptVars === "object") {
                for (var key in options.scriptVars) {
                    script = script.replace(new RegExp("%" + key + "%", "g"), options.scriptVars[key]);
                }
            }

            var sshOptions = [
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "PasswordAuthentication=no",
                "-o", "IdentityFile=" + privateKey.path
            ];

            return call("ssh", pm.context.package.path, sshOptions.concat([
                options.username + "@" + options.hostname,
                "cat > " + PATH.basename(options.scriptPath)
            ]), {
                stdin: script
            }).then(function() {

                options.scriptPath = PATH.basename(options.scriptPath);

                return exports.call(pm, options);

            });

        } else {
            throw new Error("NYI");
        }
    });
}

exports.call = function(pm, options) {

    ASSERT(typeof options.sshPrivateKeyPath !== "undefined", "`config.sshPrivateKeyPath` is required!");

    var privateKey = new CREDENTIALS_SSH.PrivateKey(pm.context.credentials, options.sshPrivateKeyPath);

    return privateKey.ensureInAuthenticationAgent().then(function() {

        if (typeof options.scriptPath !== "undefined") {

            var sshOptions = [
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "PasswordAuthentication=no",
                "-o", "IdentityFile=" + privateKey.path
            ];

            return call("ssh", pm.context.package.path, sshOptions.concat([
                "-o", "BatchMode=yes",
                // Ensure remote process dies when SSH connection drops.
                // TODO: Keep it running & check on reconnect? (> ~/bootstrap.log 2> ~/bootstrap.error.log &)
                "-t", "-t",
                options.username + "@" + options.hostname,
                options.binName, options.scriptPath
            ]));

        } else {
            throw new Error("NYI");
        }
    });
}


function call(bin, basePath, args, options) {

    options = options || {};

    var deferred = Q.defer();

    TERM.stdout.writenl("\0cyan(Running: " + bin + " " + args.join(" ") + " (cwd: " + basePath + ")\0)");

    var opts = {
        cwd: basePath
    };

    var proc = SPAWN(bin, args, opts);

    proc.on("error", function(err) {
        deferred.reject(err);
    });

    proc.stdout.on("data", function(data) {
        TERM.stdout.write(data.toString().replace(/\\n/g, "\n"));
    });

    var stderr = "";
    proc.stderr.on("data", function(data) {
        stderr += data.toString();
        TERM.stderr.write(data.toString());
    });
    proc.on("exit", function(code) {
        if (code !== 0) {
            var err = new Error("Error: " + stderr);
            if (/Connection refused/.test(stderr)) {
                err.code = "CONNECTION_REFUSED";
            }
            deferred.reject(err);
            return;
        }
        deferred.resolve();
    });

    if (typeof options.stdin !== "undefined") {
        proc.stdin.write(options.stdin);
        proc.stdin.end();
    }

    return deferred.promise;
}

