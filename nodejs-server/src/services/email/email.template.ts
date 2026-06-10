import GMT_CONFIG from "../../config/gmt.config";

export function generateEmailTemplate(title, body) {
    return `<!DOCTYPE html
 PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">
    <title>GMT</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Montserrat">
	<link href="https://fonts.googleapis.com/css?family=Barlow:300,400,500,600,700,800&display=swap" rel="stylesheet"/>
</head>
<body marginheight="0" topmargin="0" marginwidth="0" style="margin: 0px; background-color: #f2f3f8;" leftmargin="0">
    <!--100% body table-->
    <table cellspacing="0" border="0" cellpadding="0" width="100%" bgcolor="#f2f3f8"
        style="@import url(https://fonts.googleapis.com/css?family=Rubik:300,400,500,700|Open+Sans:300,400,600,700); font-family: 'Open Sans', sans-serif;">
        <tr>
            <td>
                <table style="background-color: #f2f3f8; max-width:670px;  margin:0 auto;" width="100%" border="0"
                    align="center" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="height:80px;">&nbsp;</td>
                    </tr>
                    <tr>
                        <td style="text-align:left;background:#184f67;padding:20px 20px 20px 30px;">
                          <a href="${GMT_CONFIG.pwaUrl}" title="logo" target="_blank">
                            <img width="100" src="${GMT_CONFIG.pwaUrl}/assets/images/gmt_logo.png" title="GMT" alt="GMT">
                          </a>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <table width="100%" border="0" align="left" cellpadding="0" cellspacing="0"
                                style="max-width:670px;background:#fff; border-radius:3px; text-align:left;-webkit-box-shadow:0 6px 18px 0 rgba(0,0,0,.06);-moz-box-shadow:0 6px 18px 0 rgba(0,0,0,.06);box-shadow:0 6px 18px 0 rgba(0,0,0,.06);">
                                <tr>
                                    <td style="height:40px;">&nbsp;</td>
                                </tr>
                                <tr>
                                    <td style="padding:0px 5px 15px 30px;color:#184f67;">
                                        <h1 style="color:#184f67;font-weight:"bold"; margin:0;font-size:32px;font-family:'Rubik',sans-serif;">
                                        ${title}
                                        </h1>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 5px 30px 30px;">
                                        <span style="display:inline-block; vertical-align:middle; margin:29px 0 26px; border-bottom:1px solid #cecece; width:100px;"></span>
                                        <div style="color:#184f67; font-size:18px;line-height:24px; margin:0;">
                                            ${body}
                                        </div>
                                    </td>
                                </tr>
                               <tr>
                                    <td style="padding:10px 5px 30px 30px;">
                                        <span style="display:inline-block; vertical-align:middle; margin:29px 0 26px; border-bottom:1px solid #cecece; width:100px;"></span>
                                        <p style="color:#455056; font-size:15px;line-height:24px; margin:0;">
                                             Best wishes,
                                        </p>
                                        <p style="color:#455056; font-size:15px;line-height:24px; margin:0;">
                                             Novel-T
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="height:40px;">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    <tr>
                        <td style="text-align:right;display: flex;background: #184f67;justify-content: flex-end;">
    <img style="width: 10%;margin-right: 5%;" src="${GMT_CONFIG.pwaUrl}/assets/images/NovelT_logo.png"/>
                        </td>
                    </tr>
                    <tr>
                        <td style="height:80px;">&nbsp;</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
}
