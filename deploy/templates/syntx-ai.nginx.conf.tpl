# Only this private owner namespace and its two exact OAuth metadata endpoints.
# Included INSIDE an existing TLS server block. The helper does not edit that server block.
location ^~ @@BASE_PATH@@/ {
@@PROXY_SETTINGS@@
}
location = /.well-known/oauth-authorization-server@@BASE_PATH@@ {
@@PROXY_SETTINGS@@
}
location = /.well-known/oauth-protected-resource@@BASE_PATH@@/mcp {
@@PROXY_SETTINGS@@
}
