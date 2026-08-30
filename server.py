"""
本地开发服务器
功能：托管静态文件（前端统一使用JSONP直连东方财富API，无需代理）
启动方式：python server.py
访问地址：http://localhost:8081
"""
import http.server
import os
import socket
import sys

PORT = 8081
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


def get_local_ip():
    """获取本机局域网IP地址"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """简化日志的静态文件处理器"""

    def log_message(self, format, *args):
        # 静默处理：过滤静态资源日志，且兼容send_error的HTTPStatus参数
        try:
            raw = args[0]
            path = (raw.split()[1] if isinstance(raw, str) else '') if args else ''
        except (IndexError, AttributeError):
            path = ''
        # 过滤静态资源和favicon请求
        if not any(path.endswith(ext) for ext in ['.css', '.js', '.png', '.ico', '.jpg']):
            sys.stderr.write("[http] %s\n" % (format % args))

    def do_GET(self):
        """处理GET请求，对缺失资源返回204而非404（避免控制台报错）"""
        f = self.send_head()
        if f:
            try:
                self.copyfile(f, self.wfile)
                f.close()
            except Exception:
                f.close()
        elif self.path == '/favicon.ico':
            # favicon缺失时返回空204，不打印错误
            self.send_response(204)
            self.end_headers()


class ReusableHTTPServer(http.server.HTTPServer):
    """允许端口重用的HTTP服务器，进程退出后端口立即释放"""
    allow_reuse_address = True


def main():
    os.chdir(STATIC_DIR)

    # 尝试启动服务器，端口被占用则递增
    port = PORT
    httpd = None
    while port < PORT + 10:
        try:
            httpd = ReusableHTTPServer(('', port), QuietHandler)
            break
        except OSError:
            print(f"端口 {port} 已被占用，尝试 {port + 1}...")
            port += 1

    if httpd is None:
        print("错误: 端口 8080~8089 均被占用，请手动释放后重试")
        sys.exit(1)

    local_ip = get_local_ip()
    print(f"开发服务器已启动:")
    print(f"  - 本机访问: http://localhost:{port}")
    print(f"  - 局域网访问: http://{local_ip}:{port}")
    print(f"  - 数据获取: 浏览器端JSONP直连东方财富API（无需代理）")
    print(f"按 Ctrl+C 停止服务器")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("\n服务器已停止")


if __name__ == '__main__':
    main()
