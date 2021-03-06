var utils = require('./utils'),
    glob = require('glob'),
    async = require('async'),
    fileLib = require("node-fs"),
    path = require('path'),
    _ = require('lodash'),
    fs = require('fs'),
    mkdirp = require('mkdirp');

var basePath = process.cwd(),
    pathSep = '/',
    pathLib = path;


var defaultInstallOptions = {
  "includePackageNameInInstallPath": true
};

function installFile(f, pakcfg, paths, dep, infixDir, silent, options, callback) {

    var f_s, // The path for the file to be moved
    f_name, // The full path for the file to be moved
    path, // The path for the new file location
    f_name_new, // The new file name, if we are mapping to a new name
    key = pakcfg.key;

    // If the dependency is an object, it must 
    // be a mapping, so configure things to rename
    // the file
    if (_.isObject(f)) {
        for (var dep_key in f) {
            f_s = dep_key;
            f_name_new = f[f_s];
        }
    } else {
        f_s = f;
    }

    // If the file path doesn't include the current location, add it
    f_name = f_s.indexOf(basePath) === 0 ? f_s : basePath + pathSep + f_s;

    // add subdirectories if glob are "**"
    var subDir = '';

    if (!f_name_new) {
        last = dep.match(/([a-z|A-Z]*)\/\*\*/i)
        if (last && typeof last[1] !== undefined) {
            f_name_helper = f_name.split(dep.replace('/**',''));
            subDir = (f_name_helper[1] != '') ? pathLib.dirname(f_name_helper[1]) : f_name_helper[1];
        }
    }

	if(infixDir != '') {
		subDir = pathSep + infixDir + subDir;
	}


    // If the configured paths is a map, use the path for the given file extension
    if (paths.all) {

        path = utils.parsePath(paths.all, pakcfg) + pathSep + key + subDir;

    } else {
        // Determine the path by regular expression...
        path = utils.getPathByRegExp(f_name, paths)
                // ...or by file extension.
                || paths[utils.getExtension(f_name)]

        if (path && typeof path !== 'undefined') {

            if (!utils.hasVariableInPath(path)) {
                path += (options.includePackageNameInInstallPath ? pathSep + key : '') + subDir;
            }
            else {
                path = utils.parsePath(path, pakcfg) + subDir;
            }

        }else{
          path = '';
        }
    }

    mkdirp.sync(pathLib.normalize(basePath + pathSep + path), 0755);

    var name = f_name_new ? f_name_new : pathLib.basename(f_name);
    var f_path = basePath + pathSep + path + (path ? pathSep : '') + utils.parsePath(name, pakcfg);

    // For mapped files, create the directory if it doesn't exist
    if (f_name_new && !fileLib.existsSync(pathLib.normalize(pathLib.dirname(f_path)))) {
        fileLib.mkdirSync(pathLib.normalize(pathLib.dirname(f_path)));
    }

    // If package.json file was parsed
   if (fs.lstatSync(f_name).isDirectory()) {

        var packagejson = f_name + pathSep + "package.json";

        // we want the build to continue as default if case something fails
        try {
            // read package.json file
            var file = fs.readFileSync(packagejson).toString('ascii')

            // parse file
            var filedata = JSON.parse(file);

            // path to file from main property inside package.json
            var mainpath = f_name + pathSep + filedata.main;

            // if we have a file reference on package.json to main property and it is a file
            if (fs.lstatSync(mainpath).isFile()) {

                f_name = mainpath;
                // Update the output path with the correct file extension
                if (!paths.all) {
                    path = paths[getExtension(mainpath)];
                }
                f_path = basePath + pathSep + path + pathSep + filedata.main;
            }

        } catch (error) {
            // We wont need to show log error, if package.json doesnt exist default to download folder
            // console.log(error);
        }
    }

    if (!fs.lstatSync(f_name).isDirectory() && f_name !== f_path) {
        utils.copyFile(f_name, f_path, function(error) {
            if (!error) {
            	if (!silent) {
	                console.log(('\t' + key + ' : ' + f_path).green);
            	}
            } else {
            	if (!silent) {
	                console.log(('Error\t' + f + ' : ' + f_path).red);
        	        console.log('\t\t' + error);
            	}
            }
            callback(error);
        });
    } else {
        callback();
    }
}

exports.installDependency = function installDependency(deps, pakcfg, cfg, paths, silent, callback) {
    var base, other;

    var key = pakcfg.key;
    var options = {};
    if (cfg.options) {
      options = cfg.options;
    } else {
      Object.keys(defaultInstallOptions).forEach(function(key) {
        options[key] = defaultInstallOptions[key];
      });
    }

    // Look for an overriden source
    if (cfg.sources && cfg.sources[key]) {
        // local path, so should work
        deps = cfg.sources[key];
    } else {
        deps = deps.split(',');
    }

    if (deps.options && typeof deps.options === 'object') {
      Object.keys(deps.options).forEach(function(key) {
        if (typeof defaultInstallOptions[key] === 'undefined') {
          console.warn("option " + key + " is not a valid install option");
        } else {
          options[key] = deps.options[key];
        }
      });
    }

    // Check for mapping which will map old file names to new ones
    if (deps.mapping) {
        deps = deps.mapping;
    }

    // Ensure we always are dealing with an array
    if (!_.isArray(deps)) {
        deps = [deps];
    }

    // Install each dependency
    async.each(deps, function(dep, callback) {

		var src, dest;

        // If the file is an object, it is for mapping (renaming) the source 
        // file to a new filename in the destination. Because of this, it 
        // does not make sense to do a file glob, just immediately install
        // the file
        if (_.isObject(dep)) {

			// dep is in the form { src : dest }. extrac the key and value.
			for (var dep_key in dep) {
				src = dep_key;
				dest = dep[src];
			}

			// is the input path a glob?
			if(/\*\*/.test(src)) {

				glob(src, function(err, files) {
					if (err) {
						if (!silent) {
							console.log(('Error globbing \t' + key + ' : ' + src).red);
							console.log(('\t\t' + err).red);
						}
					} else {
						async.each(files, function(f, callback) {
							installFile(f, pakcfg, paths, src, dest, silent, options, callback);
						}, callback);
					}
				});

			} else {
	            installFile(dep, pakcfg, paths, dep, '', silent, options, callback);
			}
        } else {
            glob(dep, function(err, files) {
                if (err) {
                    if (!silent) {
                    	console.log(('Error globbing \t' + key + ' : ' + dep).red);
                    	console.log(('\t\t' + err).red);
                    }
                } else {
                    async.each(files, function(f, callback) {
                        installFile(f, pakcfg, paths, dep, '', silent, options, callback);
                    }, callback);
                }
            });
        }
    }, callback);
};

exports.removeComponentsDir = function(callback) {
    utils.deleteFolderRecursive(basePath + pathSep + 'bower_components');
    callback();
}
