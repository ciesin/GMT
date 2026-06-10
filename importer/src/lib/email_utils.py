# -*- coding: utf-8 -*-
import smtplib

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging

log = logging.getLogger('gts.email_functions')


# ------------------------------------------------------------------------------------------------
#  	Description: 	Send notification email 
#					
#	Usage:     		SendEmail(Subject, # Required: email subject as string
#							            Body) # Required email body as string) 	
#
#	Version:       	1.0 (19/04/2015)
#	Updated:		1.1 (25/04/2015). Allow multi destinees.
#	Author:			P. BRIAND
# ------------------------------------------------------------------------------------------------	
def SendEmailOld(SMTPServer, SMTPPort, SMTPFrom, SMTPPassword, SMTPTo, Subject, Body):
    if SMTPTo:

        COMMASPACE = ', '

        msg = MIMEMultipart()
        msg['From'] = SMTPFrom
        msg['To'] = COMMASPACE.join(SMTPTo)
        msg['Subject'] = Subject

        msg.attach(MIMEText(Body, 'plain'))

        try:

            server = smtplib.SMTP_SSL(SMTPServer, SMTPPort)
            server.login(SMTPFrom, SMTPPassword)
            text = msg.as_string()
            server.sendmail(SMTPFrom, SMTPTo, text)
            server.quit()

        except Exception as e:
            log.debug('Cannot send email: ' + str(e))


def SendEmail(cfg, Subject, Body, SMTPTo):
    log.debug("Sending email.  Subject %s Body %s To %s", Subject or "No Subject", Body or "No Body", SMTPTo or "No To")

    if SMTPTo:

        msg = MIMEMultipart()
        msg['From'] = cfg.SMTPFrom
        COMMASPACE = ', '
        if isinstance(SMTPTo, str):
            msg['To'] = SMTPTo
        else:
            msg['To'] = COMMASPACE.join(SMTPTo)

        msg['Subject'] = Subject

        Body = "<div style='font-family:Calibri;font-size:11pt'>" + Body + u"""

<p>Best regards,</p>
<p>The Vaccination Tracking System (VTS)</p>

</div>

<p ><span ><b><span
style='font-size:16.0pt;font-family:"Arial Unicode MS",sans-serif;color:black;
mso-no-proof:yes'><o:p>&nbsp;</o:p></span></b></span></p>

<p ><span ><b><span
style='font-size:16.0pt;font-family:"Arial Unicode MS",sans-serif;color:black;
mso-no-proof:yes'>N<span style='font-variant:small-caps'>ovel</span>-</span></b></span><span
><b><span style='font-size:18.0pt;font-family:
"Arial Unicode MS",sans-serif;color:#D80000;mso-no-proof:yes'>T</span></b></span><span
><b><span style='font-size:16.0pt;font-family:
"Arial Unicode MS",sans-serif;color:black;mso-no-proof:yes'> </span></b></span><span
><span style='font-size:10.0pt;font-family:
"Arial Unicode MS",sans-serif;color:black;mso-no-proof:yes'>Sàrl</span></span><span
><span style='font-size:12.0pt;font-family:
"Arial Unicode MS",sans-serif;color:#1F497D;mso-no-proof:yes'></span></span></p>



<p ><span ><span
style='font-size:9.0pt;font-family:"Arial Unicode MS",sans-serif;color:black;
mso-no-proof:yes'>W: </span></span><span ></span><a
href="http://www.novel-t.ch/"><span ><span
style='font-size:10.0pt;mso-ascii-font-family:Calibri;mso-fareast-font-family:
"Times New Roman";mso-fareast-theme-font:minor-fareast;mso-hansi-font-family:
Calibri;color:#D80000;mso-no-proof:yes'>www.novel-t.ch</span></span><span
></span></a><span ><span
style='font-size:9.0pt;font-family:"Arial Unicode MS",sans-serif;color:black;
mso-no-proof:yes'> | @: </span></span><span ></span><a
href="mailto:vts@novel-t.ch"><span ><span
style='font-size:10.0pt;mso-ascii-font-family:Calibri;mso-fareast-font-family:
"Times New Roman";mso-fareast-theme-font:minor-fareast;mso-hansi-font-family:
Calibri;color:blue;mso-no-proof:yes'>vts@novel-t.ch</span></span><span
></span></a><span ><span
style='mso-ascii-font-family:Calibri;mso-fareast-font-family:Calibri;
mso-hansi-font-family:Calibri;mso-bidi-font-family:"Times New Roman";
color:#1F497D;mso-no-proof:yes'></span></span></p>

"""

        msg.attach(MIMEText(Body, 'html', 'utf-8'))

        try:

            if cfg.SMTPUseTls:
                log.debug(f"Using TLS {cfg.SMTPServer} and {cfg.SMTPPort}")
                server = smtplib.SMTP(cfg.SMTPServer, cfg.SMTPPort)
                #server.ehlo()
                server.starttls()
                server.ehlo()
            elif cfg.SMTPUseSsl:
                log.debug("Using SSL")
                server = smtplib.SMTP_SSL(cfg.SMTPServer, cfg.SMTPPort)
            else:
                server = smtplib.SMTP(cfg.SMTPServer, cfg.SMTPPort)

            if cfg.SMTPPassword is not None:
                server.login(cfg.SMTPFrom, cfg.SMTPPassword)
            text = msg.as_string()
            server.sendmail(cfg.SMTPFrom, SMTPTo, text)
            server.quit()

        except Exception as e:
            log.exception(e)
            log.error('Cannot send email with body: ' + str(e))
