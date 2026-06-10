<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true; section>
<#if section = "header">
<img src="${url.resourcesPath}/img/gmt_logo.png" class="gmtTitle"/>
<div class="sub-title">
    <!--    What is GMT for?-->
</div>
<div class="resetTitle">
    ${msg("emailForgotTitle")}
    <#elseif section = "form">

    <form id="kc-reset-password-form" class="resetForm" action="${url.loginAction}" method="post">
        <div class="resetMessage">
            Enter your username or email address.<br/>
            We will send you instructions on how to create a new password.
        </div>
<!--            <label for="username" class="${properties.kcLabelClass!}">-->
<!--                <#if !realm.loginWithEmailAllowed>${msg("username")}-->
<!--                <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}-->
<!--                <#else>${msg("email")}</#if>-->
<!--            </label>-->
        <input type="text"
             id="username" name="username" class="${properties.kcInputClass!}" autofocus
             placeholder="<#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>"/>

        <input class="resetButton" type="submit" value="${msg("doSubmit")}"/>
    </form>
    <a class="resetBack" href="${url.loginUrl}">${kcSanitize(msg("backToLogin"))?no_esc}</a>
    <#elseif section = "info" ></#if>
</@layout.registrationLayout>