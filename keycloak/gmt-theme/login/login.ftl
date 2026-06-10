<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true displayInfo=social.displayInfo displayWide=(realm.password && social.providers??); section>
<#if section = "header">
<img src="${url.resourcesPath}/img/gmt_logo.png" class="gmtTitle"/>
<div class="sub-title">
<!--    What is GMT for?-->
</div>
<#elseif section = "form">
<div id="kc-form" <#if realm.password && social.providers??>class="${properties.kcContentWrapperClass!}"</#if>>

<div id="kc-form-wrapper" <#if realm.password && social.providers??>class="${properties.kcFormSocialAccountContentClass!} ${properties.kcFormSocialAccountClass!}"</#if>>

<div class="doLogIn">${msg("doLogIn")}</div>
<#if realm.password>
<form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction?replace("http://", "//")}" method="post">
<div class="${properties.kcFormGroupClassLogin!}">
    <#if usernameEditDisabled??>
    <input tabindex="1" id="username" placeholder="Username" class="light_gray_input ${properties.kcInputClass!}" name="username"
           value="${(login.username!'')}" type="text" disabled/>
    <#else>
    <input tabindex="1" id="username" placeholder="Username" class="light_gray_input ${properties.kcInputClass!}" name="username"
           value="${(login.username!'')}" type="text" autofocus autocomplete="off"/>
</#if>
</div>

<div class="${properties.kcFormGroupClassLogin!} password-group">
    <input tabindex="2" id="password" class="light_gray_input ${properties.kcInputClass!}" placeholder="Password" name="password"
           type="password" autocomplete="off"/>
   <div id="eye-icon" onclick="show_hide_pwd()"></div>
</div>

<a tabindex="5" href="${url.loginResetCredentialsUrl}" class="forgotPassword link">${msg("doForgotPassword")}</a>

<div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
    <input tabindex="4"
           class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
           name="login" id="kc-login" type="submit" value="Ok"/>
</div>
</form>

</#if>
</div>
</div>
<#if realm.password && social.providers??>
<div class="socialLoginWrapper">
    <div class="loginTitle">
        <span class="border"></span>
        <span>or login with</span>
        <span class="border"></span>
    </div>
    <div class="${properties.kcFormSocialAccountListClass!} <#if social.providers?size gt 4>${properties.kcFormSocialAccountDoubleListClass!}</#if>">
        <#list social.providers as p>
        <a href="${p.loginUrl}" id="zocial-${p.alias}"
           class="${properties.kcFormSocialAccountListLinkClass!} ${p.providerId} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
            <div class="social-icon-container">
                <div class="social-icon"></div>
            </div>
            <div class="social-label-container">${p.displayName}</div>
        </a>
    </#list>
</div>
</div>
</#if>
</#if>

</@layout.registrationLayout>
