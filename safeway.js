// PhantomJS API http://phantomjs.org/api/
// Sample Usage
// /cygdrive/c/PROGRAMMER/phantomjs/bin/phantomjs.exe --ignore-ssl-errors=true --debug=false safeway.js | grep "SCRIPT:"

var page = require('webpage').create();
//evaluate runs in a sandbox so we don't get the console.log msgs w/o listening to msg
page.onConsoleMessage = function(msg) {
    var dt = new Date().getTime();
    console.log("(" + dt + ") " + msg);
};

if (page.injectJs('config.js')) {
    var config = page.evaluate(function() {
        //defined in separate "config" file, which is not source-controlled
        return CouponClipper.config;
    });
    var store = config.store.safeway;

    main();
} else {
    console.log('SCRIPT: Failed to include config.js');
    exit(false);
}

function main() {
    // var page = require('webpage').create();
    var url;
    var settings = {
        operation: 'POST',
        encoding: 'utf8',
        headers: {
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
            "userId": store.user,
            "username": store.user,
            "password": store.password,
            "source": "WEB",
            "rememberMe": false
        })
    };

    page.settings.userAgent = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36';
    // page.viewportSize = { width: 480, height: 640 };
    //1. authenticate
    url = 'https://www.safeway.com/iaaw/service/authenticate';
    //TODO:? url = 'https://albertsons.okta.com/api/v1/authn';
    console.log("SCRIPT: Attempting Authentication: " + url);
    page.open(url, settings, function (status) {
        console.log("SCRIPT: Status: " + status + "; URL: " + page.url);
        if (status === 'success') {
            //save the page as an image
            page.render(store.name + '-auth.png');

            //2. load coupons
            url = 'https://www.safeway.com/ShopStores/Justforu-Coupons.page?reloaded=true#/category/all';
            page.open(url, function (status) {
                var isOnline, i, intervalId;

                console.log("SCRIPT: Status: " + status + "; URL: " + page.url);
                // page.render(config.store.name + '-load.png');
                // console.log("SCRIPT: Loaded");
                if (status === 'success') {
                    //Injects external JS into the page
                    // if (!page.injectJs('clip.js')){
                    //     console.log('FAILURE: could not inject clip.js');
                    //     phantom.exit(1);
                    // }
                    // console.log('SCRIPT: '+page.content);
                    for (i = 0; i < 5; i++) {
                        isOnline = page.evaluate(function () {
                            return ($('#j4u-error-body').length === 0);
                        });
                        if (isOnline) {
                            console.log('SCRIPT: Page is ready ' + i);
                            page.render(store.name + '-ready.png');
                            break;
                        } else {
                            console.log('SCRIPT: Page is offline - attempt: ' + i);
                            page.reload();
                        }
                    }
                    if (!isOnline) {
                        console.log('SCRIPT: Failed to load coupons');
                        exit(false);
                        return;
                    }

                    //3. scroll the page to force all coupons to load
                    intervalId = window.setInterval(function () {
                        var isScrollComplete, clipCount, totalCount, waitTime;

                        console.log('SCRIPT: Run interval ' + intervalId);
                        isScrollComplete = page.evaluate(function () {
                            var el = document.body,
                                scrollTop = el.scrollTop,
                                scrollHeight = el.scrollHeight,
                                innerHeight = window.innerHeight;

                            if ((scrollHeight - (innerHeight + scrollTop)) > 0) {
                                console.log('SCRIPT: Scrolling page from ' + (scrollTop + innerHeight) + ' to ' + scrollHeight);
                                //do NOT scroll by a large amount or the events may not trigger
                                el.scrollTop += 100;
                                //window.scrollTo(0, scrollHeight);

                                //as long as we are scrolling, we are not done
                                return false;
                            }
                            //reached the bottom
                            console.log('SCRIPT: Scrolling complete ');
                            return true;
                        });

                        if (isScrollComplete) {
                            window.clearInterval(intervalId);
                            console.log('SCRIPT: Cleared interval ' + intervalId);
                            page.render(store.name + '-scroll.png');

                            //4. clip all available coupons
                            clipCount = page.evaluate(function () {
                                var coupons = $("div.lt-offer-Clip.ng-scope"),
                                    count = coupons.length;

                                console.log('SCRIPT: Found ' + count + ' coupons');
                                if (count > 0) {
                                    coupons.each(function (i) {
                                        var coupon = $(this);
                                        console.log('SCRIPT: Clipping (' + i + ') ' + coupon.parent('div.lt-offer-not-added').find('.lt-coupon-ccpd-title').text());
                                        coupon.click();
                                        console.log('SCRIPT: Clipped ' + i);
                                    });
                                } else {
                                    //didn't find anymore coupons - assume done
                                }
                                return count;
                            });

                            totalCount = page.evaluate(function(){
                                return $("div.lt-offer.ng-scope").length;
                            });

                            waitTime = 1000 + (clipCount * 2500);
                            console.log('SCRIPT: waiting ' + (waitTime / 1000) + ' seconds for ajax requests to complete ');
                            //must pause to let the ajax requests get sent for all coupons
                            window.setTimeout(function () {
                                page.render(store.name + '-coupon.png');
                                sendEmail('Safeway script complete. Clipped '+clipCount+' out of '+totalCount + ' coupons.', exit);
                            }, waitTime);
                        }
                    }, 1000);

                } else {
                    console.log('SCRIPT: FAILURE: could not open coupon page');
                    exit(false);
                }
            });
        } else {
            console.log('SCRIPT: FAILURE: could not authenticate');
            exit(false);
        }
    });
}

/**
 *
 * @param {Boolean} success
 */
function exit(success){
    console.log('SCRIPT: exiting');
    page.close();
    phantom.exit(success ? 0 : 1);
}

/**
 * https://blog.dotnetframework.org/2014/04/22/send-email-from-phantomjs/
 * @param {String} body
 * @param {Function} callback
 */
function sendEmail(body, cb){
    var url = config.email.url,
        data = {
            from: config.email.from,
            to: config.email.to,
            subject: store.name + ' ' + config.email.subject,
            text: body + "\n\n" + new Date().getTime()
        };

    console.log('SCRIPT: email authentication');
    page.customHeaders = {
        'Authorization': 'Basic '+window.btoa(config.email.key)
    };
    page.open(url, 'post', toQueryString(data), function (status) {
        console.log('SCRIPT: email post status');
        if (status !== 'success') {
            console.log('SCRIPT: FAILURE could not send email');
            console.log(status);
            cb.call(this,false);
        } else {
            var result = page.evaluate(function () {
                return document.body.innerText;
            });

            console.log('SCRIPT: email post result: ' + JSON.stringify(result));
            cb.call(this,true);
        }
    });
}

function toQueryString(object) {
    var params = [],
        value, key;

    for (key in object){
        value = object[key];
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }

    return params.join('&');
}
