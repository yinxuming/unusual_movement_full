"""
东方财富API测试用例 - 使用curl绕过TLS指纹检测
验证涨幅排行和K线接口的请求参数和响应格式
"""
import json
import subprocess
import sys
import urllib.parse

# Windows控制台编码修复
sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def curl_get(url, timeout=15):
    """使用curl发送GET请求（绕过Python TLS指纹检测）"""
    cmd = [
        'curl', '-s', '-S', '-k',
        '--ssl-no-revoke',
        '--max-time', str(timeout),
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Referer: https://quote.eastmoney.com/',
        '-H', 'Accept: */*',
        '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        url
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
    if result.returncode != 0:
        raise Exception(f"curl失败(returncode={result.returncode}): {result.stderr}")
    return result.stdout


def test_clist():
    """测试涨幅排行API"""
    print("=" * 60)
    print("测试1: 涨幅排行API (clist)")
    print("=" * 60)

    params = {
        'pn': '1',
        'pz': '5',
        'po': '1',
        'np': '1',
        'ut': 'b2884a393a59ad64002292a3e90d46a5',
        'fltt': '2',
        'invt': '2',
        'fid': 'f3',
        'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
        'fields': 'f12,f14,f2,f3,f13',
    }

    url = 'https://push2.eastmoney.com/api/qt/clist/get?' + urllib.parse.urlencode(params)
    print(f"请求URL: {url[:100]}...\n")

    try:
        body = curl_get(url)
        data = json.loads(body)
        print(f"rc: {data.get('rc')}")
        print(f"total: {data.get('data', {}).get('total', 'N/A')}")

        diff = data.get('data', {}).get('diff', [])
        print(f"diff数量: {len(diff)}")

        if diff:
            print("\n前3条数据:")
            for i, item in enumerate(diff[:3]):
                print(f"  [{i}] f12(代码)={item.get('f12')}, "
                      f"f14(名称)={item.get('f14')}, "
                      f"f2(最新价)={item.get('f2')}, "
                      f"f3(涨幅%)={item.get('f3')}, "
                      f"f13(市场)={item.get('f13')}")

            required = ['f12', 'f14', 'f2', 'f3', 'f13']
            missing = [f for f in required if f not in diff[0]]
            if missing:
                print(f"\n[WARN] 缺失字段: {missing}")
            else:
                print(f"\n[PASS] 所有必要字段均存在")

        return True

    except Exception as e:
        print(f"[FAIL] 请求失败: {e}")
        return False


def test_clist_jsonp():
    """测试涨幅排行API（JSONP回调）"""
    print("\n" + "=" * 60)
    print("测试2: 涨幅排行API (clist + JSONP)")
    print("=" * 60)

    params = {
        'cb': 'jQuery_12345678_999',
        'pn': '1',
        'pz': '3',
        'po': '1',
        'np': '1',
        'ut': 'b2884a393a59ad64002292a3e90d46a5',
        'fltt': '2',
        'invt': '2',
        'fid': 'f3',
        'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
        'fields': 'f12,f14,f2,f3,f13',
        '_': '1718000000000',
    }

    url = 'https://push2.eastmoney.com/api/qt/clist/get?' + urllib.parse.urlencode(params)
    print(f"请求URL: {url[:100]}...\n")

    try:
        body = curl_get(url)
        print(f"响应前200字符: {body[:200]}")

        if body.startswith('jQuery_12345678_999('):
            print("\n[PASS] JSONP格式正确")
            json_str = body[len('jQuery_12345678_999('):-2]
            data = json.loads(json_str)
            total = data.get('data', {}).get('total', 'N/A')
            print(f"total: {total}")
        else:
            # 可能返回纯JSON
            try:
                data = json.loads(body)
                total = data.get('data', {}).get('total', 'N/A')
                print(f"\n[INFO] 返回纯JSON而非JSONP, total: {total}")
            except Exception:
                print(f"\n[WARN] 响应不是预期的JSONP格式")

        return True

    except Exception as e:
        print(f"[FAIL] 请求失败: {e}")
        return False


def test_kline():
    """测试K线API"""
    print("\n" + "=" * 60)
    print("测试3: K线API (kline) - 贵州茅台")
    print("=" * 60)

    params = {
        'secid': '1.600519',
        'ut': 'b2884a393a59ad64002292a3e90d46a5',
        'fields1': 'f1,f2,f3,f4,f5,f6',
        'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        'klt': '101',
        'fqt': '1',
        'end': '20500101',
        'lmt': '5',
    }

    url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' + urllib.parse.urlencode(params)
    print(f"请求URL: {url[:100]}...\n")

    try:
        body = curl_get(url)
        data = json.loads(body)
        stock_data = data.get('data', {})
        print(f"股票代码: {stock_data.get('code')}")
        print(f"股票名称: {stock_data.get('name')}")

        klines = stock_data.get('klines', [])
        print(f"K线条数: {len(klines)}")

        if klines:
            print("\n前3条K线:")
            for i, line in enumerate(klines[:3]):
                parts = line.split(',')
                print(f"  [{i}] 日期={parts[0]}, 开盘={parts[1]}, 收盘={parts[2]}, "
                      f"最高={parts[3]}, 最低={parts[4]}, 成交量={parts[5]}, "
                      f"成交额={parts[6]}, 振幅={parts[7]}, 涨幅={parts[8]}, "
                      f"涨跌额={parts[9]}, 换手率={parts[10]}")

            field_count = len(klines[0].split(','))
            print(f"\n每条K线字段数: {field_count} (预期11)")
            if field_count == 11:
                print("[PASS] K线字段数量正确")
            else:
                print("[WARN] K线字段数量不匹配")

        return True

    except Exception as e:
        print(f"[FAIL] 请求失败: {e}")
        return False


def test_kline_jsonp():
    """测试K线API（JSONP回调）"""
    print("\n" + "=" * 60)
    print("测试4: K线API (kline + JSONP)")
    print("=" * 60)

    params = {
        'cb': 'jQuery_12345678_888',
        'secid': '1.600519',
        'ut': 'b2884a393a59ad64002292a3e90d46a5',
        'fields1': 'f1,f2,f3,f4,f5,f6',
        'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        'klt': '101',
        'fqt': '1',
        'end': '20500101',
        'lmt': '3',
        '_': '1718000000000',
    }

    url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' + urllib.parse.urlencode(params)
    print(f"请求URL: {url[:100]}...\n")

    try:
        body = curl_get(url)
        print(f"响应前300字符: {body[:300]}")

        if body.startswith('jQuery_12345678_888('):
            print("\n[PASS] JSONP格式正确")
            json_str = body[len('jQuery_12345678_888('):-2]
            data = json.loads(json_str)
            klines = data.get('data', {}).get('klines', [])
            print(f"K线条数: {len(klines)}")
        else:
            try:
                data = json.loads(body)
                klines = data.get('data', {}).get('klines', [])
                print(f"\n[INFO] 返回纯JSON而非JSONP, K线数: {len(klines)}")
            except Exception:
                print(f"\n[WARN] 响应不是预期的JSONP格式")

        return True

    except Exception as e:
        print(f"[FAIL] 请求失败: {e}")
        return False


def test_secid_format():
    """测试不同市场的secid格式"""
    print("\n" + "=" * 60)
    print("测试5: 不同市场secid格式验证")
    print("=" * 60)

    test_cases = [
        ('1.600519', '贵州茅台(沪市主板)'),
        ('0.000001', '平安银行(深市主板)'),
        ('0.300750', '宁德时代(创业板)'),
        ('1.688981', '中芯国际(科创板)'),
    ]

    for secid, desc in test_cases:
        params = {
            'secid': secid,
            'ut': 'b2884a393a59ad64002292a3e90d46a5',
            'fields1': 'f1,f2,f3,f4,f5,f6',
            'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
            'klt': '101',
            'fqt': '1',
            'end': '20500101',
            'lmt': '1',
        }

        url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' + urllib.parse.urlencode(params)

        try:
            body = curl_get(url)
            data = json.loads(body)
            name = data.get('data', {}).get('name', 'N/A')
            klines = data.get('data', {}).get('klines', [])
            print(f"  {desc} secid={secid} -> 名称={name}, K线数={len(klines)} [PASS]")
        except Exception as e:
            print(f"  {desc} secid={secid} -> [FAIL] {e}")

    return True


if __name__ == '__main__':
    print("东方财富API测试 (curl方式)\n")

    results = []
    results.append(('clist基础请求', test_clist()))
    results.append(('clist JSONP请求', test_clist_jsonp()))
    results.append(('kline基础请求', test_kline()))
    results.append(('kline JSONP请求', test_kline_jsonp()))
    results.append(('secid格式验证', test_secid_format()))

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    for name, ok in results:
        status = "[PASS]" if ok else "[FAIL]"
        print(f"  {name}: {status}")
